import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/shared/infrastructure/prisma';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId, assertRole } from '@/shared/application/routeHelpers';
import { NotFoundError, ValidationError, BusinessRuleViolationError, ForbiddenError } from '@/shared/errors/AppError';
import { auditLog } from '@/modules/audit/application/auditLog.service';
import { UserRole } from '@prisma/client';

type Ctx = { params: Promise<{ userId: string }> };

const UpdateUserSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  role: z.nativeEnum(UserRole).optional(),
});

/**
 * GET    /api/v1/users/[userId] — detail user
 * PATCH  /api/v1/users/[userId] — update nama atau role
 * DELETE /api/v1/users/[userId] — hapus user dari workspace (tidak menghapus akun globalnya)
 *
 * Keamanan: semua tiga aksi dibatasi OWNER. Tanpa itu, akun ber-role rendah
 * bisa menaikkan perannya sendiri menjadi OWNER (privilege escalation) atau
 * mengeluarkan pemiliknya dari workspace.
 */

export async function GET(request: NextRequest, { params }: Ctx) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    assertRole(ctx, UserRole.OWNER);
    const { userId } = await params;

    const membership = await prisma.tenantMembership.findFirst({
      where: { userId, tenantId: ctx.tenantId },
      include: { user: { select: { id: true, name: true, email: true, createdAt: true } } },
    });
    if (!membership) throw new NotFoundError('Pengguna', userId);

    return successResponse(
      {
        membershipId: membership.id,
        userId: membership.user.id,
        name: membership.user.name,
        email: membership.user.email,
        role: membership.role,
        joinedAt: membership.createdAt,
        userCreatedAt: membership.user.createdAt,
      },
      { requestId },
    );
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    assertRole(ctx, UserRole.OWNER);
    const { userId } = await params;

    const body: unknown = await request.json();
    const parsed = UpdateUserSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Data tidak valid.', { fields: parsed.error.flatten().fieldErrors });
    }

    // Jangan sampai administrator menurunkan atau menaikkan perannya sendiri
    // lewat UI — itu membuat hak akses tidak konsisten dan mudah dikelabui.
    if (parsed.data.role && userId === ctx.userId) {
      throw new BusinessRuleViolationError('Anda tidak dapat mengubah peran akun Anda sendiri.');
    }

    const membership = await prisma.tenantMembership.findFirst({
      where: { userId, tenantId: ctx.tenantId },
      include: { user: true },
    });
    if (!membership) throw new NotFoundError('Pengguna', userId);

    await prisma.$transaction(async (tx) => {
      if (parsed.data.name) {
        await tx.user.update({ where: { id: userId }, data: { name: parsed.data.name } });
      }
      if (parsed.data.role) {
        await tx.tenantMembership.update({
          where: { id: membership.id },
          data: { role: parsed.data.role },
        });
      }
    });

    await auditLog({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'user_update',
      entityType: 'User',
      entityId: userId,
      metadata: parsed.data,
    });

    return successResponse({ updated: true, userId }, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    assertRole(ctx, UserRole.OWNER);
    const { userId } = await params;

    // Prevent self-deletion
    if (userId === ctx.userId) {
      throw new BusinessRuleViolationError('Anda tidak dapat menghapus akun Anda sendiri dari workspace.');
    }

    const membership = await prisma.tenantMembership.findFirst({
      where: { userId, tenantId: ctx.tenantId },
    });
    if (!membership) throw new NotFoundError('Pengguna', userId);

    // Jangan biarkan pemilik terakhir workspace bisa dikeluarkan — yang tersisa
    // tidak akan punya hak akses apa pun ke tokonya sendiri.
    if (membership.role === UserRole.OWNER) {
      const otherOwners = await prisma.tenantMembership.count({
        where: { tenantId: ctx.tenantId, role: UserRole.OWNER, userId: { not: userId } },
      });
      if (otherOwners === 0) {
        throw new ForbiddenError(
          'Ini adalah satu-satunya akun Owner. Buat akun Owner lain sebelum mengeluarkan akun ini.',
        );
      }
    }

    await prisma.tenantMembership.delete({ where: { id: membership.id } });

    await auditLog({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'user_remove',
      entityType: 'User',
      entityId: userId,
      metadata: { removedRole: membership.role },
    });

    return successResponse({ removed: true, userId }, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
