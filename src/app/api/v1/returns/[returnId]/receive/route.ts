import { type NextRequest } from 'next/server';
import { receiveReturn } from '@/modules/returns/application/return.usecase';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';

export async function POST(request: NextRequest, { params }: { params: Promise<{ returnId: string }> }) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const { returnId } = await params;
    await receiveReturn(ctx.tenantId, returnId, ctx.userId);
    return successResponse({ message: 'Paket retur berhasil diterima dan siap diinspeksi.' }, { requestId });
  } catch (error) { return handleRouteError(error, requestId, request); }
}
