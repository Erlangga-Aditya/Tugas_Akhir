import { type NextRequest } from 'next/server';
import { prisma } from '@/shared/infrastructure/prisma';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/integrations/shopee/health
 *
 * Kesehatan sinkronisasi: apakah ada pesanan Shopee yang DILEWATI karena produknya
 * belum ada di sistem (SKU belum ter-mapping). Tanpa ini, pesanan bisa "hilang"
 * tanpa ada yang sadar.
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);

    const lastRun = await prisma.syncRun.findFirst({
      where: { tenantId: ctx.tenantId, operation: 'import_orders' },
      orderBy: { startedAt: 'desc' },
      select: { startedAt: true, status: true, recordsWritten: true, metadataJson: true },
    });

    const meta = (lastRun?.metadataJson ?? null) as
      | { skippedOrders?: number; unmappedSkus?: string[]; unmappedOrders?: string[] }
      | null;

    const skippedOrders = meta?.skippedOrders ?? 0;
    const unmappedSkus = meta?.unmappedSkus ?? [];

    return successResponse(
      {
        lastSyncAt: lastRun?.startedAt ?? null,
        lastSyncStatus: lastRun?.status ?? null,
        skippedOrders,
        unmappedSkus,
        unmappedOrders: meta?.unmappedOrders ?? [],
        needsProductSync: skippedOrders > 0 || unmappedSkus.length > 0,
      },
      { requestId },
    );
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
