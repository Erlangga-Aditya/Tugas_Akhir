import { type NextRequest } from 'next/server';
import { scanReturnArrival, ScanReturnArrivalSchema } from '@/modules/returns/application/return.usecase';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';
import { ValidationError } from '@/shared/errors/AppError';

/**
 * POST /api/v1/returns/[returnId]/arrival — catat barang retur yang benar-benar
 * sudah datang di gudang (hasil pindai fisik).
 *
 * Endpoint ini TIDAK menambah stok. Stok hanya naik saat inspeksi, dan hanya
 * sejumlah unit yang tercatat di sini. Retur naik ke `ARRIVED` setelah seluruh
 * isinya tercatat, dan hanya dari situ operator bisa menekan "Terima".
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ returnId: string }> }) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const { returnId } = await params;

    const body: unknown = await request.json();
    const parsed = ScanReturnArrivalSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Data hasil pindai retur tidak valid.', {
        fields: parsed.error.flatten().fieldErrors,
      });
    }

    const result = await scanReturnArrival(ctx.tenantId, returnId, parsed.data, ctx.userId);
    return successResponse(result, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
