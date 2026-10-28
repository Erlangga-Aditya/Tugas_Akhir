import { type NextRequest } from 'next/server';
import { registerReturn, listReturns, RegisterReturnSchema } from '@/modules/returns/application/return.usecase';
import { successResponse, created, handleRouteError } from '@/shared/application/apiResponse';
import {
  getAuthContext,
  getRequestId,
  parsePagination,
  getQueryParam,
  getEnumQueryParam,
  assertPermission,
} from '@/shared/application/routeHelpers';
import { ReturnStatus } from '@prisma/client';

/** Nilai `?status=` yang sah, diambil dari enum Prisma. */
const RETURN_STATUSES = Object.values(ReturnStatus);

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    assertPermission(ctx, 'page.returns');
    const { page, pageSize } = parsePagination(request);
    // Nilai asing diabaikan (tidak memfilter), bukan diteruskan ke Prisma:
    // cast `as ReturnStatus` tidak berlaku saat berjalan, dan nilai asing
    // membuat query gagal lalu endpoint membalas daftar kosong.
    const status = getEnumQueryParam(request, 'status', RETURN_STATUSES);
    const result = await listReturns(ctx.tenantId, {
      status,
      search: getQueryParam(request, 'search'),
      page,
      pageSize,
    });
    return successResponse(result, { requestId });
  } catch (error) { return handleRouteError(error, requestId, request); }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    assertPermission(ctx, 'page.returns');
    const body: unknown = await request.json();
    const validated = RegisterReturnSchema.parse(body);
    const result = await registerReturn(ctx.tenantId, validated, ctx.userId);
    return created(result, requestId);
  } catch (error) { return handleRouteError(error, requestId, request); }
}
