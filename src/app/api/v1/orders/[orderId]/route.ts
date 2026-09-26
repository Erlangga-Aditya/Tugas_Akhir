import { type NextRequest } from 'next/server';
import { getOrderDetail } from '@/modules/orders/application/order.usecase';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';

// GET /api/v1/orders/[orderId]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const requestId = getRequestId(request);

  try {
    const ctx = getAuthContext(request);
    const { orderId } = await params;

    const order = await getOrderDetail(ctx.tenantId, orderId);
    return successResponse(order, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
