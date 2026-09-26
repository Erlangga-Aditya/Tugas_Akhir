import { type NextRequest } from 'next/server';
import { prisma } from '@/shared/infrastructure/prisma';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const membership = await prisma.tenantMembership.findFirst({
      where: { userId: ctx.userId, tenantId: ctx.tenantId },
      include: { user: true, tenant: true },
    });
    if (!membership) {
      return successResponse({ user: null, tenantId: ctx.tenantId, tenantName: null, role: ctx.role }, { requestId });
    }
    return successResponse(
      {
        user: { id: membership.user.id, name: membership.user.name, email: membership.user.email },
        tenantId: ctx.tenantId,
        tenantName: membership.tenant.name,
        role: membership.role,
      },
      { requestId },
    );
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
