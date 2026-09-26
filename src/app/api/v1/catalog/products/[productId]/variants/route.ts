import { type NextRequest } from 'next/server';
import { addVariant, CreateVariantSchema } from '@/modules/catalog/application/catalog.usecase';
import { created, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';

type Ctx = { params: Promise<{ productId: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const { productId } = await params;
    const body: unknown = await request.json();
    const validated = CreateVariantSchema.parse(body);
    const variant = await addVariant(ctx.tenantId, productId, validated, ctx.userId);
    return created(variant, requestId);
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
