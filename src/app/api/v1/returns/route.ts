import { type NextRequest } from 'next/server';
import { registerReturn, listReturns, RegisterReturnSchema } from '@/modules/returns/application/return.usecase';
import { successResponse, created, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId, parsePagination, getQueryParam } from '@/shared/application/routeHelpers';
import type { ReturnStatus } from '@prisma/client';

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const { page, pageSize } = parsePagination(request);
    const status = getQueryParam(request, 'status') as ReturnStatus | undefined;
    const result = await listReturns(ctx.tenantId, { status, page, pageSize });
    return successResponse(result, { requestId });
  } catch (error) { return handleRouteError(error, requestId, request); }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const body: unknown = await request.json();
    const validated = RegisterReturnSchema.parse(body);
    const result = await registerReturn(ctx.tenantId, validated, ctx.userId);
    return created(result, requestId);
  } catch (error) { return handleRouteError(error, requestId, request); }
}
