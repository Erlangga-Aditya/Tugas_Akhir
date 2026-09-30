import { z } from 'zod';
import { prisma } from '@/shared/infrastructure/prisma';
import { verifyPassword } from '../infrastructure/password.service';
import type { AuthContext } from '../domain/entities/auth.entity';
import { PERMISSIONS, type Permission } from '../domain/permissions';
import {
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
} from '@/shared/errors/AppError';
import { auditLog } from '@/modules/audit/application/auditLog.service';

// ────────────────────────────────────────────────────────────
// Input schemas (Zod)
// ────────────────────────────────────────────────────────────

export const LoginSchema = z.object({
  email: z.string().email('Format email tidak valid.').toLowerCase(),
  password: z.string().min(1, 'Password tidak boleh kosong.'),
  tenantId: z.string().optional(),
});

export type LoginInput = z.infer<typeof LoginSchema>;

export interface LoginResult {
  context: AuthContext;
  tenantName: string;
  user: { id: string; name: string; email: string };
}

/**
 * Login with database-backed credentials (no demo backdoor).
 * FR-AUTH-001, FR-AUTH-004. Token signing + cookie is done by the route.
 */
/**
 * Baca daftar izin dari kolom JSON.
 *
 * Dua lapis pencadangan:
 *  1. Kolomnya `Json?` di Prisma, jadi bisa `null`. `null` berarti belum ada
 *     izin — bukan "semua".
 *  2. Isinya bisa rusak (mis. ditimpa manual di database), jadi setiap entri
 *     divalidasi terhadap registry. Izin yang sudah dihapus dari registry
 *     diabaikan diam-diam supaya perubahan kode tidak merusak sesi lama.
 */
export function readPermissions(raw: unknown): Permission[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (p): p is Permission => typeof p === 'string' && Object.hasOwn(PERMISSIONS, p),
  );
}

export async function loginUser(input: LoginInput): Promise<LoginResult> {
  const parsed = LoginSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('Data login tidak valid.', { fields: parsed.error.flatten().fieldErrors });
  }
  const { email, password, tenantId } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { email },
    include: { memberships: { include: { tenant: true } } },
  });

  // Constant-time comparison regardless of whether the user exists.
  const dummyHash = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO7q6qX0w9vQp5W5b3Z0Z0Z0Z0Z0Z0Z0Z0Z0Z0Z';
  const isValid = user ? await verifyPassword(password, user.passwordHash) : await verifyPassword(password, dummyHash).then(() => false);

  if (!user || !isValid) throw new UnauthorizedError('Email atau password tidak valid.');
  if (user.status !== 'ACTIVE') throw new UnauthorizedError('Akun Anda tidak aktif. Hubungi administrator.');

  const activeMemberships = user.memberships.filter((m) => m.tenant.status === 'ACTIVE');
  if (activeMemberships.length === 0) throw new UnauthorizedError('Anda tidak terdaftar pada tenant aktif manapun.');

  let membership = activeMemberships[0]!;
  if (tenantId) {
    const found = activeMemberships.find((m) => m.tenantId === tenantId);
    if (!found) throw new ForbiddenError('Anda tidak memiliki akses ke tenant tersebut.');
    membership = found;
  } else if (activeMemberships.length > 1) {
    throw new ConflictError('Anda terdaftar di beberapa tenant. Pilih tenant terlebih dahulu.', {
      tenants: activeMemberships.map((m) => ({ id: m.tenantId, name: m.tenant.name, role: m.role })),
    });
  }

  await auditLog({
    tenantId: membership.tenantId, actorId: user.id, action: 'user_login',
    entityType: 'User', entityId: user.id,
  });

  return {
    context: {
      userId: user.id,
      email: user.email,
      tenantId: membership.tenantId,
      role: membership.role as AuthContext['role'],
      permissions: readPermissions(membership.permissions),
    },
    tenantName: membership.tenant.name,
    user: { id: user.id, name: user.name, email: user.email },
  };
}
