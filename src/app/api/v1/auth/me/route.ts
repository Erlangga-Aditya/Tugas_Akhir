import { type NextRequest } from 'next/server';
import { prisma } from '@/shared/infrastructure/prisma';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';
import { hasPermission } from '@/modules/auth/domain/entities/auth.entity';
import { PERMISSIONS, PERMISSION_KEYS, type Permission } from '@/modules/auth/domain/permissions';

/** Buang izin yang sudah tidak ada di registry — sama seperti di login. */
function normalize(raw: unknown): Permission[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (p): p is Permission => typeof p === 'string' && Object.hasOwn(PERMISSIONS, p),
  );
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);

    // Izin dibaca dari membership terbaru, bukan dari JWT. JWT membawa salinan
    // izin saat login supaya route handler tidak query database; `/me` adalah
    // tempat yang tepat untuk mengambil salinan terbaru supaya perubahan izin
    // langsung terasa di UI tanpa perlu logout.
    const membership = await prisma.tenantMembership.findFirst({
      where: { userId: ctx.userId, tenantId: ctx.tenantId },
      include: { user: true, tenant: true },
    });
    if (!membership) {
      return successResponse(
        {
          user: null,
          tenantId: ctx.tenantId,
          tenantName: null,
          role: ctx.role,
          permissions: ctx.role === 'OWNER' ? [...PERMISSION_KEYS] : [],
        },
        { requestId },
      );
    }
    // OWNER tidak butuh daftar izin dari database; mengisinya dari registry
    // membuat `/me` seragam untuk kedua peran.
    const staffPermissions =
      membership.role === 'OWNER' ? [...PERMISSION_KEYS] : normalize(membership.permissions);

    return successResponse(
      {
        user: {
          id: membership.user.id,
          name: membership.user.name,
          email: membership.user.email,
          status: membership.user.status,
        },
        tenantId: ctx.tenantId,
        tenantName: membership.tenant.name,
        role: membership.role,
        /**
         * Ringkasan izin dalam bentuk "apakah boleh" per halaman, supaya sidebar
         * cukup memeriksa satu boolean dan tidak perlu tahu bentuk daftarnya.
         * `can` dihitung di server supaya aturan OWNER/STAFF tidak terduplikasi
         * di frontend.
         */
        can: Object.fromEntries(
          PERMISSION_KEYS.map((key) => [
            key,
            hasPermission({ role: membership.role, permissions: staffPermissions }, key),
          ]),
        ),
      },
      { requestId },
    );
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
