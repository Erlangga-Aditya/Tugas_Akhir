import { type NextRequest } from 'next/server';
import { prisma } from '@/shared/infrastructure/prisma';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const shops = await prisma.shop.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, provider: true, name: true, externalShopId: true, status: true },
    });
    return successResponse(shops, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
