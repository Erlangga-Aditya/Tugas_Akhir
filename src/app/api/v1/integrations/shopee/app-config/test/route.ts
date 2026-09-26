import { type NextRequest } from 'next/server';
import { ShopeeAdapter } from '@/modules/integrations/infrastructure/shopee.adapter';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/integrations/shopee/app-config/test
 *
 * Uji kredensial partner ke server Shopee (Public API get_shops_by_partner).
 * Hasilnya diteruskan apa adanya supaya operator tahu persis statusnya.
 */
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    getAuthContext(request);
    const result = await new ShopeeAdapter().testCredentials();
    return successResponse(result, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
