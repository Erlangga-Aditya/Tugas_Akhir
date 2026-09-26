import { type NextRequest } from 'next/server';
import { updateVariant, UpdateVariantSchema, deleteVariant } from '@/modules/catalog/application/catalog.usecase';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';

type Ctx = { params: Promise<{ productId: string; variantId: string }> };

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const { variantId } = await params;
    const body: unknown = await request.json();
    const validated = UpdateVariantSchema.parse(body);
    const updated = await updateVariant(ctx.tenantId, variantId, validated, ctx.userId);
    return successResponse(updated, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const { variantId } = await params;
    await deleteVariant(ctx.tenantId, variantId, ctx.userId);
    return successResponse({ deleted: true, variantId }, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
