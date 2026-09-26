import { type NextRequest } from 'next/server';
import { triggerOrderSync, listSyncRuns } from '@/modules/integrations/application/sync.service';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId, getQueryParam } from '@/shared/application/routeHelpers';
import { ValidationError } from '@/shared/errors/AppError';

/**
 * GET  /api/v1/integrations/shopee/sync?shopId=...&operation=... — daftar sync run pesanan
 * POST /api/v1/integrations/shopee/sync — trigger sinkronisasi pesanan
 */

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const shopId = getQueryParam(request, 'shopId');
    const operation = getQueryParam(request, 'operation') ?? 'import_orders';
    const runs = await listSyncRuns(ctx.tenantId, shopId, operation);
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
    const result = await triggerOrderSync(ctx.tenantId, body.shopId, ctx.userId);
    return successResponse(
      { message: 'Sinkronisasi pesanan selesai.', syncRun: result },
      { requestId },
    );
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
