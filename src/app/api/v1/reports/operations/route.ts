import { type NextRequest } from 'next/server';
import { getOperasionalRingkas } from '@/modules/reports/application/operations.usecase';
import { isRangePreset } from '@/modules/fulfillment/domain/date-range';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId, assertPermission } from '@/shared/application/routeHelpers';

/**
 * GET /api/v1/reports/operations?range=today|yesterday|last7|last30|all
 *
 * Ringkasan operasional untuk owner: keadaan tiap tahap sekarang, kejadian
 * dalam rentang tanggal, dan jumlah paket per pelaku (packer / kurir internal).
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    assertPermission(ctx, 'page.reports');

    const rangeParam = new URL(request.url).searchParams.get('range');
    const preset = isRangePreset(rangeParam) ? rangeParam : 'today';
    const data = await getOperasionalRingkas(ctx.tenantId, preset);
    return successResponse(data, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
