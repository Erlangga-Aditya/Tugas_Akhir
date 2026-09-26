import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/shared/infrastructure/prisma';
import { successResponse, created, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId, parsePagination, assertRole } from '@/shared/application/routeHelpers';
import { ConflictError, ValidationError } from '@/shared/errors/AppError';
import bcrypt from 'bcryptjs';
import { auditLog } from '@/modules/audit/application/auditLog.service';
import { UserRole } from '@prisma/client';

const InviteUserSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8, 'Password minimal 8 karakter'),
  role: z.nativeEnum(UserRole).default(UserRole.STAFF),
});

/**
 * GET /api/v1/users — daftar anggota workspace (tenant members)
 * POST /api/v1/users — undang / tambah pengguna baru ke workspace
 *
 * Keamanan: manajemen dan perubahan hak akses adalah urusan pemilik. Hanya OWNER
 * yang boleh melihat daftar anggota, menambahkan pengguna, atau mengubah peran.
 * Tanpa guard ini, akun ber-role rendah (mis. STAFF) bisa membuat akun OWNER
 * sendiri lewat endpoint ini — privilege escalation yang memberi akses penuh
 * ke seluruh data toko.
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    assertRole(ctx, UserRole.OWNER);
    const { page, pageSize } = parsePagination(request);
    const skip = (page - 1) * pageSize;

    const [members, total] = await Promise.all([
      prisma.tenantMembership.findMany({
        where: { tenantId: ctx.tenantId },
        include: { user: { select: { id: true, name: true, email: true, createdAt: true } } },
        orderBy: { createdAt: 'asc' },
        skip,
        take: pageSize,
      }),
      prisma.tenantMembership.count({ where: { tenantId: ctx.tenantId } }),
    ]);

    return successResponse(
      {
        items: members.map((m) => ({
          membershipId: m.id,
          userId: m.user.id,
          name: m.user.name,
          email: m.user.email,
          role: m.role,
          joinedAt: m.createdAt,
          userCreatedAt: m.user.createdAt,
        })),
        pagination: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
      },
      { requestId },
    );
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    // Hanya pemilik yang boleh menambah pengguna — dan hanya dengan peran
    // yang tidak melebihi haknya sendiri.
    assertRole(ctx, UserRole.OWNER);
    const body: unknown = await request.json();
    const parsed = InviteUserSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Data pengguna tidak valid.', { fields: parsed.error.flatten().fieldErrors });
    }

    // Check email uniqueness
    const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (existing) {
      throw new ConflictError(`Email '${parsed.data.email}' sudah terdaftar.`);
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { name: parsed.data.name, email: parsed.data.email, passwordHash },
      });
      const membership = await tx.tenantMembership.create({
        data: { userId: user.id, tenantId: ctx.tenantId, role: parsed.data.role },
      });
      return { user, membership };
    });

    await auditLog({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'user_invite',
      entityType: 'User',
      entityId: result.user.id,
      metadata: { email: result.user.email, role: parsed.data.role },
    });

    return created(
      {
        userId: result.user.id,
        name: result.user.name,
        email: result.user.email,
        role: result.membership.role,
      },
      requestId,
    );
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
