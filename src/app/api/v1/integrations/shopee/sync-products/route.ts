import { type NextRequest } from 'next/server';
import { triggerProductSync, listSyncRuns } from '@/modules/integrations/application/sync.service';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId, getQueryParam } from '@/shared/application/routeHelpers';

/**
 * GET  /api/v1/integrations/shopee/sync-products — daftar sync run produk
 * POST /api/v1/integrations/shopee/sync-products — trigger sinkronisasi produk
 */

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const shopId = getQueryParam(request, 'shopId');
    const runs = await listSyncRuns(ctx.tenantId, shopId, 'sync_products');
    return successResponse(runs, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const body = (await request.json()) as { shopId?: string };
    if (!body.shopId) {
      const { ValidationError } = await import('@/shared/errors/AppError');
      throw new ValidationError('shopId wajib diisi.');
    }
    const result = await triggerProductSync(ctx.tenantId, body.shopId, ctx.userId);
    return successResponse(
      {
        message: 'Sinkronisasi produk selesai.',
        syncRun: result,
      },
      { requestId },
    );
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
