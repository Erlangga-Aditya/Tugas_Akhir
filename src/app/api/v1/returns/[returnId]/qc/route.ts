import { type NextRequest } from 'next/server';
import { inspectReturn, InspectReturnSchema } from '@/modules/returns/application/return.usecase';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';
import { ValidationError } from '@/shared/errors/AppError';

export async function POST(request: NextRequest, { params }: { params: Promise<{ returnId: string }> }) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const { returnId } = await params;
    const body: unknown = await request.json();
    const { warehouseId, ...inputData } = (body ?? {}) as { warehouseId?: string; [k: string]: unknown };
    if (!warehouseId) throw new ValidationError('warehouseId wajib diisi.');
    const validated = InspectReturnSchema.parse(inputData);
    await inspectReturn(ctx.tenantId, returnId, validated, ctx.userId, warehouseId);
    return successResponse({ message: 'Inspeksi QC selesai dan stok telah diperbarui.' }, { requestId });
  } catch (error) { return handleRouteError(error, requestId, request); }
}
