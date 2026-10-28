import { type NextRequest } from 'next/server';
import { listOrders } from '@/modules/orders/application/order.usecase';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import {
  getAuthContext,
  getRequestId,
  getEnumQueryParam,
  assertPermission,
} from '@/shared/application/routeHelpers';
import { OrderStatus } from '@prisma/client';

/**
 * Nilai `?status=` yang sah. `OrderStatus` diimpor sebagai NILAI (bukan hanya
 * tipe) supaya daftarnya tidak pernah menyimpang dari schema.
 */
const ORDER_STATUSES = Object.values(OrderStatus);

// GET /api/v1/orders?status=NEW&shopId=...&page=1&sortByPriority=true
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);

  try {
    const ctx = getAuthContext(request);
    assertPermission(ctx, 'page.orders');
    const { searchParams } = new URL(request.url);

    // Nilai asing diabaikan (tidak memfilter), bukan diteruskan ke Prisma.
    // Cast `as OrderStatus` hanya berlaku di TypeScript; saat berjalan nilai
    // apa pun sampai ke database dan query gagal → daftar kosong tanpa pesan.
    const status = getEnumQueryParam(request, 'status', ORDER_STATUSES);
    const shopId = searchParams.get('shopId') ?? undefined;
    const page = Number(searchParams.get('page') ?? '1');
    const pageSize = Math.min(Number(searchParams.get('pageSize') ?? '50'), 100);
    const sortByPriority = searchParams.get('sortByPriority') === 'true';

    const result = await listOrders(ctx.tenantId, {
      status,
      shopId,
      page,
      pageSize,
      sortByPriority,
    });

    return successResponse(result, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
