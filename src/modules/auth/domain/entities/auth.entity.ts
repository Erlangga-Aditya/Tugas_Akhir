/**
 * Auth Domain Entities
 * These are pure domain types — no ORM dependencies.
 * (Clean Architecture: domain must not import infrastructure)
 */

export type UserRole = 'OWNER' | 'MANAGER' | 'FINANCE' | 'STAFF';
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
 */
export interface AuthContext {
  userId: string;
  tenantId: string;
  role: UserRole;
  email: string;
}

// ────────────────────────────────────────────────────────────
// Allowed role transitions / permission matrix
// ────────────────────────────────────────────────────────────

const ROLE_HIERARCHY: Record<UserRole, number> = {
  OWNER: 4,
  MANAGER: 3,
  FINANCE: 2,
  STAFF: 1,
};

export function hasMinimumRole(userRole: UserRole, requiredRole: UserRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}
