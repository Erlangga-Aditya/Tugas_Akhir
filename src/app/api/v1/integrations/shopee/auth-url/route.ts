import { type NextRequest } from 'next/server';
import { ShopeeAdapter } from '@/modules/integrations/infrastructure/shopee.adapter';
import { getShopeeAppConfig } from '@/modules/integrations/application/appConfig.service';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId, getQueryParam } from '@/shared/application/routeHelpers';
import { ValidationError } from '@/shared/errors/AppError';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/integrations/shopee/auth-url?shopId=...
 *
 * Redirect URL TIDAK lagi di-hardcode: diambil dari konfigurasi (kalau diisi) atau
 * otomatis dari origin request yang sedang dipakai — jadi pindah domain/ngrok tetap jalan.
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const shopId = getQueryParam(request, 'shopId');
    if (!shopId) throw new ValidationError('shopId wajib diisi.');

    const appConfig = await getShopeeAppConfig();
    if (!appConfig.partnerId || !appConfig.partnerKey) {
      throw new ValidationError(
        'Kredensial partner Shopee belum diisi. Lengkapi Partner ID & Partner Key di halaman Integrasi.',
      );
    }

    const redirectUri =
      appConfig.redirectUrl ?? `${new URL(request.url).origin}/api/v1/integrations/shopee/callback`;

    const adapter = new ShopeeAdapter();
    const state = Buffer.from(JSON.stringify({ tenantId: ctx.tenantId, shopId })).toString('base64url');
    const url = await adapter.buildAuthUrl(redirectUri, state);

    return successResponse({ url, mode: appConfig.mode, redirectUri }, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
