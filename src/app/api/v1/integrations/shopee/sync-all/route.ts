import { type NextRequest } from 'next/server';
import { triggerFullSync } from '@/modules/integrations/application/sync.service';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';
import { ValidationError } from '@/shared/errors/AppError';

/**
 * POST /api/v1/integrations/shopee/sync-all
 * Sinkronisasi semua sekaligus: Produk → Pesanan → Tracking → Return.
 * Setiap tahap dijalankan berurutan; jika satu gagal, tahap berikutnya tetap jalan.
 */
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const body = (await request.json()) as { shopId?: string };
    if (!body.shopId) throw new ValidationError('shopId wajib diisi.');
    const result = await triggerFullSync(ctx.tenantId, body.shopId, ctx.userId);
    return successResponse(
      { message: 'Sinkronisasi penuh selesai.', ...result },
      { requestId },
    );
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
