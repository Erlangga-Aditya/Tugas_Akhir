import { type NextRequest } from 'next/server';
import { forceRefreshToken } from '@/modules/integrations/application/sync.service';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';
import { ValidationError } from '@/shared/errors/AppError';

/**
 * POST /api/v1/integrations/shopee/refresh-token
 * Force-refresh the Shopee access token immediately.
 * Useful when the UI shows the token is about to expire.
 */
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const body = (await request.json()) as { shopId?: string };
    if (!body.shopId) throw new ValidationError('shopId wajib diisi.');
    const result = await forceRefreshToken(ctx.tenantId, body.shopId);
    return successResponse(result, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
