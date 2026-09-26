import { type NextRequest } from 'next/server';
import { getFulfillmentStation } from '@/modules/fulfillment/application/fulfillment.usecase';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/fulfillment/station
 *
 * Satu endpoint untuk STASIUN KERJA (halaman Operasi Harian):
 * semua yang perlu dikerjakan operator hari ini, tanpa perlu pindah menu.
 *  - queue      : fulfillment order aktif (WAITING_STOCK … READY_TO_SHIP) + item + shortfall + AWB
 *  - newOrders  : pesanan baru yang belum masuk antrian (perlu "Proses")
 *  - warehouse  : gudang default yang dipakai untuk memproses
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const sortParam = new URL(request.url).searchParams.get('sort');
    const station = await getFulfillmentStation(ctx.tenantId, {
      sort: sortParam === 'newest' ? 'newest' : 'oldest',
    });
    return successResponse(station, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
