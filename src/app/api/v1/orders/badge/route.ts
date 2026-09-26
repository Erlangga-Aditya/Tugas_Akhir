import { type NextRequest } from 'next/server';
import { prisma } from '@/shared/infrastructure/prisma';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';

export const dynamic = 'force-dynamic';

/** Status fulfillment yang berarti pesanan sudah beres (tidak perlu aksi lagi). */
const FINISHED_FULFILLMENT = ['READY_TO_SHIP', 'HANDED_OVER', 'COMPLETED'] as const;

/**
 * GET /api/v1/orders/badge
 *
 * Angka badge sidebar = pesanan yang MASIH BUTUH AKSI (belum selesai diproses).
 * Pesanan baru yang belum pernah diproses dihitung terpisah supaya operator tahu
 * ada pesanan yang benar-benar baru masuk.
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const where = {
      tenantId: ctx.tenantId,
      status: 'CONFIRMED' as const,
      fulfillmentOrders: { none: { status: { in: [...FINISHED_FULFILLMENT] } } },
    };

    const [count, notQueued, newest] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.count({
        where: { tenantId: ctx.tenantId, status: 'CONFIRMED', fulfillmentOrders: { none: {} } },
      }),
      prisma.order.findFirst({
        where,
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    return successResponse(
      {
        count,
        notQueued,
        newestOrderAt: newest?.createdAt?.toISOString() ?? null,
      },
      { requestId },
    );
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
