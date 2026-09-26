import { type NextRequest } from 'next/server';
import { createShipment, listShipments, CreateShipmentSchema } from '@/modules/shipping/application/shipping.usecase';
import { successResponse, created, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId, parsePagination, getQueryParam } from '@/shared/application/routeHelpers';
import type { ShipmentStatus } from '@prisma/client';

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const { page, pageSize } = parsePagination(request);
    const result = await listShipments(ctx.tenantId, {
      search: getQueryParam(request, 'search'),
      carrier: getQueryParam(request, 'carrier'),
      status: getQueryParam(request, 'status') as ShipmentStatus | undefined,
      page, pageSize,
    });
    return successResponse(result, { requestId });
  } catch (error) { return handleRouteError(error, requestId, request); }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const body: unknown = await request.json();
    const validated = CreateShipmentSchema.parse(body);
    const shipment = await createShipment(ctx.tenantId, validated, ctx.userId);
    return created(shipment, requestId);
  } catch (error) { return handleRouteError(error, requestId, request); }
}
