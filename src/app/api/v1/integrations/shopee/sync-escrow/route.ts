import { type NextRequest } from 'next/server';
import { prisma } from '@/shared/infrastructure/prisma';
import { syncEscrowDetailsForShop } from '@/modules/integrations/application/sync.service';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/integrations/shopee/sync-escrow
 * Menarik rincian biaya (komisi, biaya layanan, dana yang dilepas) dari Shopee
 * untuk pesanan yang belum punya rincian.
 */
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const body = (await request.json().catch(() => ({}))) as { shopId?: string; limit?: number };

    let shopId = body.shopId;
    if (!shopId) {
      const shop = await prisma.shop.findFirst({
        where: { tenantId: ctx.tenantId, provider: 'shopee' },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      shopId = shop?.id;
    }
    if (!shopId) {
      return successResponse({ requested: 0, updated: 0, message: 'Belum ada toko Shopee terhubung.' }, { requestId });
    }

    const result = await syncEscrowDetailsForShop(ctx.tenantId, shopId, ctx.userId, {
      limit: body.limit,
    });
    return successResponse(result, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
