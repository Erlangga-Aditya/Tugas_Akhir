import { type NextRequest } from 'next/server';
import { handOverToCarrier } from '@/modules/fulfillment/application/fulfillment.usecase';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';
import { z } from 'zod';
import { ValidationError } from '@/shared/errors/AppError';

const HandoverSchema = z.object({
  carrier: z.string().trim().min(1).optional(),
  awb: z.string().trim().min(1).optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ fulfillmentOrderId: string }> }) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const { fulfillmentOrderId } = await params;
    const body: unknown = await request.json().catch(() => ({}));
    const parsed = HandoverSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return handleRouteError(new ValidationError('Data serah terima tidak valid.'), requestId, request);
    }
    const result = await handOverToCarrier(
      ctx.tenantId,
      fulfillmentOrderId,
      ctx.userId,
      parsed.data.carrier,
      parsed.data.awb,
    );
    return successResponse({ message: 'Pesanan diserahkan ke kurir.', shipmentId: result.shipmentId }, { requestId });
  } catch (error) { return handleRouteError(error, requestId, request); }
}
