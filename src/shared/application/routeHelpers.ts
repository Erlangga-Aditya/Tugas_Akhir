import type { NextRequest } from 'next/server';
import type { AuthContext } from '@/modules/auth/domain/entities/auth.entity';
import { UnauthorizedError, ForbiddenError } from '@/shared/errors/AppError';
import { hasMinimumRole, type UserRole } from '@/modules/auth/domain/entities/auth.entity';
import { AUTH_CONTEXT_HEADER, REQUEST_ID_HEADER } from '@/shared/application/httpHeaders';

/**
 * Extract and validate AuthContext from incoming request.
 * The middleware sets the auth context header after JWT verification.
 * 
 * Route handlers call this to get the verified auth context.
 * NEVER trust the raw body/query for tenant resolution.
 */
export function getAuthContext(request: NextRequest): AuthContext {
  const header = request.headers.get(AUTH_CONTEXT_HEADER);

  if (!header) {
    throw new UnauthorizedError('Autentikasi diperlukan.');
  }

  try {
    const ctx = JSON.parse(header) as AuthContext;

    if (!ctx.userId || !ctx.tenantId || !ctx.role) {
      throw new UnauthorizedError('Konteks autentikasi tidak valid.');
    }

    return ctx;
  } catch {
    throw new UnauthorizedError('Konteks autentikasi tidak valid.');
  }
}

/**
 * Get request ID from header (set by middleware).
 */
export function getRequestId(request: NextRequest): string {
  return request.headers.get(REQUEST_ID_HEADER) ?? crypto.randomUUID();
}

/**
 * Assert that the current user has at least the required role.
 * Throws ForbiddenError if insufficient permissions.
 */
export function assertRole(ctx: AuthContext, requiredRole: UserRole): void {
  if (!hasMinimumRole(ctx.role, requiredRole)) {
    throw new ForbiddenError(
      `Tindakan ini memerlukan peran minimal ${requiredRole}. Peran Anda: ${ctx.role}.`,
    );
  }
}

/**
 * Ensure the tenantId from request matches the auth context.
 * Prevents IDOR where a user changes the tenantId in URL/body.
 * 
 * Use this when a route has :tenantId path param or body field.
 */
export function assertTenantAccess(ctx: AuthContext, requestedTenantId: string): void {
  if (ctx.tenantId !== requestedTenantId) {
    throw new ForbiddenError('Anda tidak memiliki akses ke tenant yang diminta.');
  }
}

/**
 * Parse pagination query parameters from NextRequest.
 */
export function parsePagination(request: NextRequest): { page: number; pageSize: number } {
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10)));
  return { page, pageSize };
}

/**
 * Get trimmed query parameter or undefined.
 */
export function getQueryParam(request: NextRequest, key: string): string | undefined {
  const { searchParams } = new URL(request.url);
  const val = searchParams.get(key);
  return val !== null && val.trim() !== '' ? val.trim() : undefined;
}

