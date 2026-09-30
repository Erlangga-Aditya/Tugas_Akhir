import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/shared/infrastructure/prisma';
import { successResponse, created, handleRouteError } from '@/shared/application/apiResponse';
import {
  getAuthContext,
  getRequestId,
  parsePagination,
  assertRole,
  assertPermission,
} from '@/shared/application/routeHelpers';
import { PERMISSIONS, PERMISSION_KEYS, DEFAULT_STAFF_PERMISSIONS, type Permission } from '@/modules/auth/domain/permissions';
import { ConflictError, ValidationError } from '@/shared/errors/AppError';
import bcrypt from 'bcryptjs';
import { auditLog } from '@/modules/audit/application/auditLog.service';
import { UserRole } from '@prisma/client';

const InviteUserSchema = z.object({
  name: z.string().min(2, 'Nama minimal 2 karakter').max(100),
  email: z.string().email('Format email tidak valid'),
  password: z.string().min(8, 'Password minimal 8 karakter'),
  // Hanya dua peran yang ada. OWNER tidak dibuat lewat sini: owner adalah
  // orang yang sedang login, dan menambah owner kedua berarti memberi akses
  // penuh tanpa bisa dicabut. Enough untukkisruh tuple "owner tunggal".
  role: z.literal(UserRole.STAFF).default(UserRole.STAFF),
  /**
   * Izin yang dicentang owner. `undefined` = pakai default (dasar gudang).
   * `[]` = staff tanpa akses apa pun, disengaja.
   */
  permissions: z
    .array(z.string())
    .refine(
      (arr) => arr.every((p) => PERMISSION_KEYS.includes(p as Permission)),
      { message: 'Ada izin yang tidak dikenal.' },
    )
    .optional(),
});

/** Daftar izin untuk ditampilkan di UI (label dalam bahasa awam). */
const CATALOG = PERMISSION_KEYS.map((key) => ({
  key,
  label: PERMISSIONS[key].label,
  group: PERMISSIONS[key].group,
}));

/** Buang izin yang sudah tidak ada di registry, lalu urutkan agar stabil. */
function normalize(raw: unknown): Permission[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is Permission => typeof p === 'string' && Object.hasOwn(PERMISSIONS, p))
    .sort();
}

/**
 * GET /api/v1/users — daftar anggota workspace (tenant members)
 * POST /api/v1/users — undang / tambah pengguna baru ke workspace
 *
 * Keamanan: manajemen dan perubahan hak akses adalah urusan pemilik. Hanya OWNER
 * yang boleh melihat daftar anggota, menambahkan pengguna, atau mengubah peran.
 * Tanpa guard ini, akun ber-role rendah (mis. akun non-pemilik) bisa membuat akun OWNER
 * sendiri lewat endpoint ini — privilege escalation yang memberi akses penuh
 * ke seluruh data toko.
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    assertPermission(ctx, 'team.manage');
    // `team.manage` tidak diberikan ke staff apa pun — daftar izin adalah
    // hak owner, bukan hak yang bisa diberikan ke orang lain.
    assertPermission(ctx, 'team.manage');
    const { page, pageSize } = parsePagination(request);
    const skip = (page - 1) * pageSize;

    const [members, total] = await Promise.all([
      prisma.tenantMembership.findMany({
        where: { tenantId: ctx.tenantId },
        // status wajib ikut: UI menentukan aktif/nonaktif dari sini. Tanpa
        // kolom ini, akun yang sudah dinonaktifkan masih terlihat aktif di daftar.
        include: { user: { select: { id: true, name: true, email: true, status: true, createdAt: true } } },
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
          // OWNER selalu kosong: dia bebas, jadi daftar ini tidak berguna.
          permissions: m.role === 'OWNER' ? [...PERMISSION_KEYS] : normalize(m.permissions),
          isOwner: m.role === 'OWNER',
          status: m.user.status,
          joinedAt: m.createdAt,
          userCreatedAt: m.user.createdAt,
        })),
        catalog: CATALOG,
        defaultPermissions: DEFAULT_STAFF_PERMISSIONS,
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
    assertPermission(ctx, 'team.manage');
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
        data: {
          userId: user.id,
          tenantId: ctx.tenantId,
          role: parsed.data.role,
          permissions: parsed.data.permissions ?? [...DEFAULT_STAFF_PERMISSIONS],
        },
      });
      return { user, membership };
    });

    await auditLog({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'user_invite',
      entityType: 'User',
      entityId: result.user.id,
      metadata: {
        email: result.user.email,
        role: parsed.data.role,
        permissions: result.membership.permissions,
      },
    });

    return created(
      {
        userId: result.user.id,
        name: result.user.name,
        email: result.user.email,
        role: result.membership.role,
        permissions: result.membership.permissions,
      },
      requestId,
    );
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
