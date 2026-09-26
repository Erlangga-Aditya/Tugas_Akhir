import { type NextRequest } from 'next/server';
import { markReadyToShip } from '@/modules/fulfillment/application/fulfillment.usecase';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';

export async function POST(request: NextRequest, { params }: { params: Promise<{ fulfillmentOrderId: string }> }) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const { fulfillmentOrderId } = await params;
    await markReadyToShip(ctx.tenantId, fulfillmentOrderId, ctx.userId);
    return successResponse({ message: 'Pesanan siap dikirim.' }, { requestId });
  } catch (error) { return handleRouteError(error, requestId, request); }
}
