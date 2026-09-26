import { z } from 'zod';
import { prisma } from '@/shared/infrastructure/prisma';
import { hashPassword, verifyPassword } from '../infrastructure/password.service';
import type { AuthContext } from '../domain/entities/auth.entity';
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

export const RegisterSchema = z.object({
  name: z.string().min(2, 'Nama minimal 2 karakter.').max(100),
  email: z.string().email('Format email tidak valid.').toLowerCase(),
  password: z
    .string()
    .min(8, 'Password minimal 8 karakter.')
    .regex(/[A-Z]/, 'Password harus mengandung huruf besar.')
    .regex(/[0-9]/, 'Password harus mengandung angka.'),
  tenantName: z.string().min(2, 'Nama toko minimal 2 karakter.').max(100),
});

export const LoginSchema = z.object({
  email: z.string().email('Format email tidak valid.').toLowerCase(),
  password: z.string().min(1, 'Password tidak boleh kosong.'),
  tenantId: z.string().optional(),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;

export interface RegisterResult {
  context: AuthContext;
  tenantName: string;
  user: { id: string; name: string; email: string };
}

export interface LoginResult {
  context: AuthContext;
  tenantName: string;
  user: { id: string; name: string; email: string };
}

/**
 * Register a user + first tenant + default warehouse + default Shopee shop.
 * FR-AUTH-001, FR-TEN-001.
 */
export async function registerUser(input: RegisterInput): Promise<RegisterResult> {
  const parsed = RegisterSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('Data registrasi tidak valid.', { fields: parsed.error.flatten().fieldErrors });
  }
  const { name, email, password, tenantName } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new ConflictError('Email sudah digunakan. Silakan gunakan email lain.');

  const passwordHash = await hashPassword(password);
  const slugBase = tenantName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
  const slug = slugBase || `tenant-${Date.now()}`;

  const result = await prisma.$transaction(async (tx) => {
    const existingSlug = await tx.tenant.findUnique({ where: { slug } });
    const tenant = await tx.tenant.create({
      data: { name: tenantName, slug: existingSlug ? `${slug}-${Date.now()}` : slug, status: 'ACTIVE' },
    });
    const user = await tx.user.create({
      data: { name, email, passwordHash, status: 'ACTIVE' },
    });
    await tx.tenantMembership.create({
      data: { tenantId: tenant.id, userId: user.id, role: 'OWNER' },
    });
    // Default warehouse + default Shopee shop so the workspace is usable immediately.
    await tx.warehouse.create({ data: { tenantId: tenant.id, name: 'Gudang Utama', code: 'WH-01', status: 'ACTIVE' } });
    await tx.shop.create({
      data: { tenantId: tenant.id, provider: 'shopee', name: 'Shopee', status: 'ACTIVE' },
    });
    return { tenant, user };
  });

  await auditLog({
    tenantId: result.tenant.id, actorId: result.user.id, action: 'user_registered',
    entityType: 'User', entityId: result.user.id, metadata: { email, tenantId: result.tenant.id },
  });

  return {
    context: { userId: result.user.id, email: result.user.email, tenantId: result.tenant.id, role: 'OWNER' },
    tenantName: result.tenant.name,
    user: { id: result.user.id, name: result.user.name, email: result.user.email },
  };
}

/**
 * Login with database-backed credentials (no demo backdoor).
 * FR-AUTH-001, FR-AUTH-004. Token signing + cookie is done by the route.
 */
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
    context: { userId: user.id, email: user.email, tenantId: membership.tenantId, role: membership.role as AuthContext['role'] },
    tenantName: membership.tenant.name,
    user: { id: user.id, name: user.name, email: user.email },
  };
}
