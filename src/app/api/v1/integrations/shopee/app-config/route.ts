import { type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  getShopeeAppConfigPublic,
  saveShopeeAppConfig,
} from '@/modules/integrations/application/appConfig.service';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';
import { ValidationError } from '@/shared/errors/AppError';
import { auditLog } from '@/modules/audit/application/auditLog.service';

export const dynamic = 'force-dynamic';

const SaveSchema = z.object({
  partnerId: z.string().min(1, 'Partner ID wajib diisi.'),
  partnerKey: z.string().optional(),
  mode: z.enum(['PRODUCTION', 'SANDBOX']),
  redirectUrl: z.string().url('Redirect URL harus berupa URL lengkap.').nullish(),
});

/**
 * GET /api/v1/integrations/shopee/app-config
 * Konfigurasi aplikasi partner (Partner Key TIDAK pernah dikirim ke browser).
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    getAuthContext(request);
    return successResponse(await getShopeeAppConfigPublic(), { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}

/**
 * PUT /api/v1/integrations/shopee/app-config
 * Simpan Partner ID / Partner Key / mode dari UI (tanpa edit .env).
 * Partner Key dienkripsi AES-256-GCM; kalau dikosongkan, nilai lama dipertahankan.
 */
export async function PUT(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const parsed = SaveSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError('Data konfigurasi tidak valid.', {
        fields: parsed.error.flatten().fieldErrors,
      });
    }

    await saveShopeeAppConfig(parsed.data);
    await auditLog({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'shopee_app_config_saved',
      entityType: 'MarketplaceAppConfig',
      entityId: 'shopee',
      metadata: { partnerId: parsed.data.partnerId, mode: parsed.data.mode, keyChanged: Boolean(parsed.data.partnerKey) },
    });

    return successResponse(await getShopeeAppConfigPublic(), { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
