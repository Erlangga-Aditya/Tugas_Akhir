import { type NextRequest } from 'next/server';
import { getFinanceReport } from '@/modules/reports/application/financeReport.usecase';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId, getQueryParam } from '@/shared/application/routeHelpers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/reports/finance?from=YYYY-MM-DD&to=YYYY-MM-DD&shopId=...
 *
 * Ringkasan uang: total dibayar pembeli, diskon, ongkir, potongan Shopee,
 * dan estimasi dana yang masuk ke penjual.
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const fromRaw = getQueryParam(request, 'from');
    const toRaw = getQueryParam(request, 'to');
    const shopId = getQueryParam(request, 'shopId');

    const from = fromRaw ? new Date(`${fromRaw}T00:00:00`) : undefined;
    const to = toRaw ? new Date(`${toRaw}T23:59:59`) : undefined;

    const report = await getFinanceReport(ctx.tenantId, { from, to, shopId: shopId || undefined });
    return successResponse(report, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
