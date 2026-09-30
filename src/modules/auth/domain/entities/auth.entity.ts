/**
 * Auth Domain Entities
 * These are pure domain types — no ORM dependencies.
 * (Clean Architecture: domain must not import infrastructure)
 */

import { can, type Permission } from '../permissions';

export type UserRole = 'OWNER' | 'STAFF';
export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
export type TenantStatus = 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';

export interface User {
  id: string;
  email: string;
  name: string;
  status: UserStatus;
  createdAt: Date;
}

export interface TenantMembership {
  id: string;
  tenantId: string;
  userId: string;
  role: UserRole;
  /** Kunci izin dari `permissions.ts`. Kosong = belum ada izin. */
  permissions: Permission[];
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  createdAt: Date;
}

/**
 * Auth context extracted from JWT — available on every authenticated request.
 * Injected by middleware; used by use cases for authorization.
 *
 * `permissions` ikut di dalam JWT supaya route handler tidak perlu query
 * database hanya untuk satu keputusan izin. Resiko token basi ditutup oleh
 * `maxTokenAge`: middleware menolak JWT yang lebih tua dari batas itu, jadi
 * perubahan izin owner berlaku paling lama dalam window tersebut.
 */
export interface AuthContext {
  userId: string;
  tenantId: string;
  role: UserRole;
  email: string;
  permissions: Permission[];
}

// ────────────────────────────────────────────────────────────
// Izin
// ────────────────────────────────────────────────────────────

/**
 * Apakah konteks ini boleh melakukan `permission`?
 *
 * OWNER selalu boleh: owner yang menentukan izin, jadi owner tidak mungkin
 * mengunci dirinya sendiri. Staff hanya boleh apa yang owner pilih.
 */
export function hasPermission(
  ctx: Pick<AuthContext, 'role' | 'permissions'>,
  permission: Permission,
): boolean {
  return can(ctx.role, ctx.permissions, permission);
}

/**
 * Warisan dari model role tunggal. Dipakai hanya untuk izin yang secara
 * konsep "harus OWNER" dan tidak perlu dikonfigurasi (mis. kelola tim).
 *
 * Jangan pakai ini untuk aksi operasional — pakai `hasPermission` supaya owner
 * bisa memberi atau menahan akses staff ke laporan keuangan atau pembatalan pesanan.
 */
export function hasMinimumRole(userRole: UserRole, requiredRole: UserRole): boolean {
  if (requiredRole === 'OWNER') return userRole === 'OWNER';
  return userRole === 'OWNER' || userRole === 'STAFF';
}
