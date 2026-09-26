import { type NextRequest } from 'next/server';
import { connectShopee } from '@/modules/integrations/application/sync.service';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';
import { ValidationError } from '@/shared/errors/AppError';
import { z } from 'zod';

const ConnectSchema = z.object({
  shopId: z.string().min(1),
  externalShopId: z.string().min(1),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  tokenExpiresAt: z.number().optional(),
  mainAccountId: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const body: unknown = await request.json();
    const parsed = ConnectSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError('Data koneksi tidak valid.', { fields: parsed.error.flatten().fieldErrors });
    const result = await connectShopee(ctx.tenantId, parsed.data.shopId, parsed.data);
    return successResponse(result, { requestId });
  } catch (error) { return handleRouteError(error, requestId, request); }
}
