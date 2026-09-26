import { type NextRequest } from 'next/server';
import { listInventoryMovements } from '@/modules/inventory/application/inventory.usecase';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';

// GET /api/v1/inventory/movements?warehouseId=...&variantId=...&page=1
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);

  try {
    const ctx = getAuthContext(request);
    const { searchParams } = new URL(request.url);

    const warehouseId = searchParams.get('warehouseId') ?? undefined;
    const variantId = searchParams.get('variantId') ?? undefined;
    const page = Number(searchParams.get('page') ?? '1');
    const pageSize = Math.min(Number(searchParams.get('pageSize') ?? '50'), 100);

    const result = await listInventoryMovements(ctx.tenantId, {
      warehouseId,
      variantId,
      page,
      pageSize,
    });

    return successResponse(result, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
