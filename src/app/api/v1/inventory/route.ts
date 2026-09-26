import { type NextRequest } from 'next/server';
import {
  listInventoryBalances,
} from '@/modules/inventory/application/inventory.usecase';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';

// GET /api/v1/inventory?warehouseId=...&page=1&pageSize=50&search=...
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);

  try {
    const ctx = getAuthContext(request);
    const { searchParams } = new URL(request.url);

    const warehouseId = searchParams.get('warehouseId') ?? '';
    const page = Number(searchParams.get('page') ?? '1');
    const pageSize = Math.min(Number(searchParams.get('pageSize') ?? '50'), 100);
    const search = searchParams.get('search') ?? undefined;

    const result = await listInventoryBalances(ctx.tenantId, warehouseId, {
      page,
      pageSize,
      search,
    });

    return successResponse(result, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
