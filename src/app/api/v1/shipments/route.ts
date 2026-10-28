import { type NextRequest } from 'next/server';
import { createShipment, listShipments, CreateShipmentSchema } from '@/modules/shipping/application/shipping.usecase';
import { successResponse, created, handleRouteError } from '@/shared/application/apiResponse';
import {
  getAuthContext,
  getRequestId,
  parsePagination,
  getQueryParam,
  getEnumQueryParam,
  assertPermission,
} from '@/shared/application/routeHelpers';
import { ShipmentStatus } from '@prisma/client';

/** Nilai `?status=` yang sah — diambil dari enum Prisma supaya tidak pernah
 *  menyimpang dari schema. */
const SHIPMENT_STATUSES = Object.values(ShipmentStatus);

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    assertPermission(ctx, 'page.shipping');
    const { page, pageSize } = parsePagination(request);
    const result = await listShipments(ctx.tenantId, {
      search: getQueryParam(request, 'search'),
      carrier: getQueryParam(request, 'carrier'),
      // Nilai tak dikenal (mis. `?status=ALL` dari tautan lama) diabaikan,
      // bukan diteruskan ke Prisma — kalau diteruskan, query gagal dan endpoint
      // membalas daftar kosong yang terlihat seperti data hilang.
      status: getEnumQueryParam(request, 'status', SHIPMENT_STATUSES),
      page, pageSize,
    });
    return successResponse(result, { requestId });
  } catch (error) { return handleRouteError(error, requestId, request); }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    assertPermission(ctx, 'page.shipping');
    const body: unknown = await request.json();
    const validated = CreateShipmentSchema.parse(body);
    const shipment = await createShipment(ctx.tenantId, validated, ctx.userId);
    return created(shipment, requestId);
  } catch (error) { return handleRouteError(error, requestId, request); }
}
