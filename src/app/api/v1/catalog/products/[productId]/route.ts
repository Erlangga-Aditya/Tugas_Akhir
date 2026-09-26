import { type NextRequest } from 'next/server';
import { getProductById, updateProduct, UpdateProductSchema, deleteProduct } from '@/modules/catalog/application/catalog.usecase';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';

type Ctx = { params: Promise<{ productId: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const { productId } = await params;
    return successResponse(await getProductById(ctx.tenantId, productId), { requestId });
  } catch (error) { return handleRouteError(error, requestId, request); }
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const { productId } = await params;
    const body: unknown = await request.json();
    const validated = UpdateProductSchema.parse(body);
    return successResponse(await updateProduct(ctx.tenantId, productId, validated, ctx.userId), { requestId });
  } catch (error) { return handleRouteError(error, requestId, request); }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const { productId } = await params;
    await deleteProduct(ctx.tenantId, productId, ctx.userId);
    return successResponse({ deleted: true, productId }, { requestId });
  } catch (error) { return handleRouteError(error, requestId, request); }
}
