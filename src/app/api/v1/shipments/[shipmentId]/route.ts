import { type NextRequest } from 'next/server';
import { getShipmentById } from '@/modules/shipping/application/shipping.usecase';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';

type Ctx = { params: Promise<{ shipmentId: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const { shipmentId } = await params;
    const shipment = await getShipmentById(ctx.tenantId, shipmentId);
    return successResponse(shipment, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
