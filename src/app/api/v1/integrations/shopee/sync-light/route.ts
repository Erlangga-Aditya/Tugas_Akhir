import { type NextRequest } from 'next/server';
import { triggerOrderSync } from '@/modules/integrations/application/sync.service';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';
import { prisma } from '@/shared/infrastructure/prisma';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/integrations/shopee/sync-light
 * Sinkronisasi ringan (pesanan + resi) untuk auto-sync latar belakang.
 * Event realtime-nya dikirim dari dalam triggerOrderSync setelah data tersimpan,
 * jadi tidak ada broadcast ganda di sini.
 */
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const body = (await request.json().catch(() => ({}))) as { shopId?: string };

    let shopId = body.shopId;
    if (!shopId) {
      const firstShop = await prisma.shop.findFirst({
        where: { tenantId: ctx.tenantId, provider: 'shopee' },
        orderBy: { createdAt: 'asc' },
      });
      if (firstShop) shopId = firstShop.id;
    }

    if (!shopId) {
      return successResponse({ message: 'Belum ada toko Shopee yang terhubung.', synced: false }, { requestId });
    }

    const result = await triggerOrderSync(ctx.tenantId, shopId, ctx.userId);

    return successResponse(
      {
        message: 'Sync pesanan ringan selesai.',
        synced: true,
        ...result,
      },
      { requestId },
    );
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
