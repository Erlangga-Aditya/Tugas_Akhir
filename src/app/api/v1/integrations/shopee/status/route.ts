import { type NextRequest } from 'next/server';
import { getShopeeConnectionStatus } from '@/modules/integrations/application/sync.service';
import { getShopeeAppConfigPublic } from '@/modules/integrations/application/appConfig.service';
import {
  autoSyncState,
  getAutoSyncIntervalMs,
  isAutoSyncEnabled,
} from '@/modules/integrations/application/autoSync.scheduler';
import { prisma } from '@/shared/infrastructure/prisma';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId, getQueryParam } from '@/shared/application/routeHelpers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/integrations/shopee/status?shopId=...
 *
 * Status koneksi toko + status kredensial aplikasi (Partner Key tidak pernah dikirim).
 * Kalau shopId tidak diisi, otomatis memakai toko Shopee pertama milik tenant.
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const appConfig = await getShopeeAppConfigPublic();

    let shopId = getQueryParam(request, 'shopId');
    if (!shopId) {
      const firstShop = await prisma.shop.findFirst({
        where: { tenantId: ctx.tenantId, provider: 'shopee' },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      shopId = firstShop?.id;
    }

    if (!shopId) {
      return successResponse({ connected: false, shop: null, ...appConfig }, { requestId });
    }

    const status = await getShopeeConnectionStatus(ctx.tenantId, shopId);
    return successResponse(
      {
        ...status,
        ...appConfig,
        autoSync: {
          enabled: isAutoSyncEnabled(),
          intervalMs: getAutoSyncIntervalMs(),
          // Diambil dari catatan sinkronisasi di database (bukan memori proses),
          // supaya panel status tidak pernah menampilkan "belum jalan" saat sebenarnya jalan.
          lastRunAt:
            (status.lastRun?.finishedAt ?? status.lastRun?.startedAt ?? status.lastSyncAt) as
              | Date
              | null,
          lastImported: status.lastRun?.recordsWritten ?? null,
          lastError:
            status.lastRun?.status === 'FAILED'
              ? (status.lastRun.errorMessage ?? 'Sinkronisasi terakhir gagal.')
              : autoSyncState.lastError,
        },
      },
      { requestId },
    );
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
