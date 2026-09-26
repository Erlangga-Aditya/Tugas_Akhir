import { type NextRequest } from 'next/server';
import { createProduct, listProducts, CreateProductSchema } from '@/modules/catalog/application/catalog.usecase';
import { successResponse, created, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId, parsePagination, getQueryParam } from '@/shared/application/routeHelpers';

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const { page, pageSize } = parsePagination(request);
    const result = await listProducts(ctx.tenantId, {
      search: getQueryParam(request, 'search'),
      category: getQueryParam(request, 'category'),
      status: getQueryParam(request, 'status') as 'ACTIVE' | 'INACTIVE' | 'ARCHIVED' | undefined,
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
    const validated = CreateProductSchema.parse(body);
    const product = await createProduct(ctx.tenantId, validated, ctx.userId);
    return created(product, requestId);
  } catch (error) { return handleRouteError(error, requestId, request); }
}
