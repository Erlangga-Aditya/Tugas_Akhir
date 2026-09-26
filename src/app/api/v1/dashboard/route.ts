import { type NextRequest } from 'next/server';
import { getDashboardMetrics, getPriorityDistribution } from '@/modules/reporting/application/dashboard.usecase';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';

// GET /api/v1/dashboard
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);

  try {
    const ctx = getAuthContext(request);

    const [metrics, priorityDistribution] = await Promise.all([
      getDashboardMetrics(ctx.tenantId),
      getPriorityDistribution(ctx.tenantId),
    ]);

    return successResponse(
      { metrics, priorityDistribution },
      { requestId },
    );
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
