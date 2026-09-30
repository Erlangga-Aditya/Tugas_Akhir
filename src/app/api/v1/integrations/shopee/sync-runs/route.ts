import { type NextRequest } from 'next/server';
import { listSyncRuns } from '@/modules/integrations/application/sync.service';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import {
  getAuthContext,
  getRequestId,
  parsePagination,
  getQueryParam,
  assertPermission,
} from '@/shared/application/routeHelpers';
import type { SyncStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/integrations/shopee/sync-runs
 *
 * SATU endpoint untuk seluruh riwayat sinkronisasi (semua jenis operasi).
 * Sebelumnya UI memanggil empat endpoint terpisah lalu menyatukan hasilnya di
 * browser, sehingga satu tampilan bisa menarik ratusan baris setiap kali reload.
 *
 * Query:
 *   shopId    — batasi ke satu toko
 *   operation — bisa berulang: ?operation=import_orders&operation=sync_products
 *   status    — RUNNING | SUCCESS | FAILED | PARTIAL
 *   page / pageSize
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    assertPermission(ctx, 'page.integrations');
    const { page, pageSize } = parsePagination(request);

    const operations = request.nextUrl.searchParams
      .getAll('operation')
      .flatMap((v) => v.split(','))
      .map((v) => v.trim())
      .filter(Boolean);

    const result = await listSyncRuns(ctx.tenantId, {
      shopId: getQueryParam(request, 'shopId'),
      operation: operations,
      status: getQueryParam(request, 'status') as SyncStatus | undefined,
      page,
      pageSize,
    });

    return successResponse(result, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
