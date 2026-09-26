import { type NextRequest } from 'next/server';
import { processOrderForFulfillment } from '@/modules/fulfillment/application/fulfillment.usecase';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';
import { ValidationError } from '@/shared/errors/AppError';
import { z } from 'zod';

const ReserveSchema = z.object({ warehouseId: z.string().min(1, 'warehouseId diperlukan.') });

export async function POST(request: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const { orderId } = await params;
    const body: unknown = await request.json();
    const parsed = ReserveSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError('Data tidak valid.', { fields: parsed.error.flatten().fieldErrors });
    const result = await processOrderForFulfillment(ctx.tenantId, orderId, parsed.data.warehouseId, ctx.userId);
    return successResponse(result, { requestId });
  } catch (error) { return handleRouteError(error, requestId, request); }
}
