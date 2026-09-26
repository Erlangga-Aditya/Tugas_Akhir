import { type NextRequest } from 'next/server';
import { triggerReturnSync, listSyncRuns } from '@/modules/integrations/application/sync.service';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId, getQueryParam } from '@/shared/application/routeHelpers';
import { ValidationError } from '@/shared/errors/AppError';

/**
 * GET  /api/v1/integrations/shopee/sync-returns — daftar sync run return
 * POST /api/v1/integrations/shopee/sync-returns — trigger sinkronisasi return
 */

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const shopId = getQueryParam(request, 'shopId');
    const runs = await listSyncRuns(ctx.tenantId, shopId, 'sync_returns');
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
    if (!body.shopId) throw new ValidationError('shopId wajib diisi.');
    const result = await triggerReturnSync(ctx.tenantId, body.shopId, ctx.userId);
    return successResponse(
      { message: 'Sinkronisasi return selesai.', syncRun: result },
      { requestId },
    );
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
