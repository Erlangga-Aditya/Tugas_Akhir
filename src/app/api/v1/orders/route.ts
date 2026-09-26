import { type NextRequest } from 'next/server';
import { listOrders } from '@/modules/orders/application/order.usecase';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';
import type { OrderStatus } from '@/modules/orders/domain/order.entity';

// GET /api/v1/orders?status=NEW&shopId=...&page=1&sortByPriority=true
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);

  try {
    const ctx = getAuthContext(request);
    const { searchParams } = new URL(request.url);

    const status = searchParams.get('status') as OrderStatus | null;
    const shopId = searchParams.get('shopId') ?? undefined;
    const page = Number(searchParams.get('page') ?? '1');
    const pageSize = Math.min(Number(searchParams.get('pageSize') ?? '50'), 100);
    const sortByPriority = searchParams.get('sortByPriority') === 'true';

    const result = await listOrders(ctx.tenantId, {
      status: status ?? undefined,
      shopId,
      page,
      pageSize,
      sortByPriority,
    });

    return successResponse(result, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
