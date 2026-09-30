import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/shared/infrastructure/prisma';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import {
  getAuthContext,
  getRequestId,
  assertPermission,
} from '@/shared/application/routeHelpers';
import { PERMISSIONS, PERMISSION_KEYS, type Permission } from '@/modules/auth/domain/permissions';
import { NotFoundError, ValidationError, BusinessRuleViolationError, ForbiddenError } from '@/shared/errors/AppError';
import { auditLog } from '@/modules/audit/application/auditLog.service';
import { UserRole, UserStatus } from '@prisma/client';

type Ctx = { params: Promise<{ userId: string }> };

/** Buang izin yang sudah tidak ada di registry, lalu urutkan agar stabil. */
function normalize(raw: unknown): Permission[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is Permission => typeof p === 'string' && Object.hasOwn(PERMISSIONS, p))
    .sort();
}

const UpdateUserSchema = z.object({
  name: z.string().min(2, 'Nama minimal 2 karakter').max(100).optional(),
  role: z.nativeEnum(UserRole).optional(),
  /**
   * Izin staff. Sengaja `z.array`, bukan `z.optional()` dengan
   * default: `undefined` berarti "tidak diubah" (PATCH), `[]` berarti
   * "tarik semua izin" dan itu harus bisa terjadi.
   */
  permissions: z
    .array(z.string())
    .refine((arr) => arr.every((p) => PERMISSION_KEYS.includes(p as Permission)), {
      message: 'Ada izin yang tidak dikenal.',
    })
    .optional(),
  /** Nonaktifkan/m aktifkan tanpa menghapus riwayat karyawannya. */
  status: z.nativeEnum(UserStatus).optional(),
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
    assertPermission(ctx, 'team.manage');
    const { userId } = await params;

    const membership = await prisma.tenantMembership.findFirst({
      where: { userId, tenantId: ctx.tenantId },
      include: { user: { select: { id: true, name: true, email: true, status: true, createdAt: true } } },
    });
    if (!membership) throw new NotFoundError('Pengguna', userId);

    return successResponse(
      {
        membershipId: membership.id,
        userId: membership.user.id,
        name: membership.user.name,
        email: membership.user.email,
        role: membership.role,
        status: membership.user.status,
        permissions:
          membership.role === 'OWNER' ? [...PERMISSION_KEYS] : normalize(membership.permissions),
        isOwner: membership.role === 'OWNER',
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
    assertPermission(ctx, 'team.manage');
    const { userId } = await params;

    const body: unknown = await request.json();
    const parsed = UpdateUserSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Data tidak valid.', { fields: parsed.error.flatten().fieldErrors });
    }

    // Jangan sampai administrator menurunkan atau menaikkan perannya sendiri
    // lewat UI — itu membuat hak akses tidak konsisten dan mudah dikelabui.
    if ((parsed.data.role || parsed.data.status || parsed.data.permissions) && userId === ctx.userId) {
      throw new BusinessRuleViolationError(
        'Anda tidak dapat mengubah peran, status, atau izin akun Anda sendiri.',
      );
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
      if (parsed.data.permissions) {
        // Normalisasi dulu supaya database tidak pernah menyimpan izin asing
        // (mis. sisa versi lama saat registry berubah).
        await tx.tenantMembership.update({
          where: { id: membership.id },
          data: { permissions: normalize(parsed.data.permissions) },
        });
      }
      if (parsed.data.status) {
        await tx.user.update({ where: { id: userId }, data: { status: parsed.data.status } });
      }
    });

    await auditLog({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'user_update',
      entityType: 'User',
      entityId: userId,
      metadata: {
        name: parsed.data.name ?? null,
        role: parsed.data.role ?? null,
        status: parsed.data.status ?? null,
        // Catat izin BARU dan LAMA supaya jejak audit menunjukkan perubahan.
        permissionsBefore:
          membership.role === 'OWNER' ? 'ALL' : normalize(membership.permissions),
        permissionsAfter: parsed.data.permissions ? normalize(parsed.data.permissions) : null,
      },
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
    assertPermission(ctx, 'team.manage');
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

    // Jangan hapus akunnya. Account-nya masih pemilik riwayat picking,
    // penyesuaian stok, dan handover; menghapusnya membuat audit log menunjuk
    // ke user yang tidak ada. Menonaktifkan memberi efek yang sama tanpa
    // merusak jejak.
    await prisma.user.update({ where: { id: userId }, data: { status: 'INACTIVE' } });
    // Dan cabut aksesnya seketika, jangan tunggu owner logout.
    await prisma.tenantMembership.update({
      where: { id: membership.id },
      data: { permissions: [] },
    });

    await auditLog({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'user_deactivate',
      entityType: 'User',
      entityId: userId,
      metadata: { removedRole: membership.role },
    });

    return successResponse(
      { deactivated: true, userId, message: 'Akun dinonaktifkan dan aksesnya dicabut.' },
      { requestId },
    );
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
