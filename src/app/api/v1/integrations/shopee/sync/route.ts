import { type NextRequest } from 'next/server';
import {
  triggerOrderSync,
  triggerFullSync,
  listSyncRuns,
} from '@/modules/integrations/application/sync.service';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import {
  getAuthContext,
  getRequestId,
  getQueryParam,
  assertPermission,
} from '@/shared/application/routeHelpers';
import { resolveShopId } from '@/modules/integrations/application/resolveShopId';

/**
 * GET  /api/v1/integrations/shopee/sync?shopId=...&operation=... — daftar sync run pesanan
 * POST /api/v1/integrations/shopee/sync — sinkronisasi pesanan
 * POST /api/v1/integrations/shopee/sync  { "full": true } — sinkronisasi penuh
 *
 * Sinkronisasi penuh menjalankan produk lebih dulu, baru pesanan, lalu
 * pelacakan. Urutan itu penting: pesanan hanya bisa diimpor kalau barangnya
 * sudah punya pemetaan varian, dan pemetaan itu dibuat oleh sinkronisasi
 * produk. Tanpa sinkronisasi produk, seluruh pesanan akan dilewati dengan
 * alasan "semua item tidak ter-mapping" - dan dari layar operator itu tampak
 * seperti pesanan tidak pernah masuk.
 *
 * Sebelumnya urutan ini HANYA berjalan sekali saat otorisasi toko. Bila
 * langkah produk gagal pada saat itu, tidak ada cara mengulanginya tanpa
 * memutus dan menghubungkan ulang toko.
 */

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    assertPermission(ctx, 'shopee.sync');
    const shopId = getQueryParam(request, 'shopId');
    const operation = getQueryParam(request, 'operation') ?? 'import_orders';
    const runs = await listSyncRuns(ctx.tenantId, {
      shopId,
      operation: operation ? [operation] : undefined,
    });
    return successResponse(runs, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    assertPermission(ctx, 'shopee.sync');
    // Body boleh kosong: `resolveShopId` memakai toko tunggal yang terhubung.
    const body = (await request.json().catch(() => ({}))) as { shopId?: string; full?: boolean };
    const shopId = await resolveShopId(ctx.tenantId, body.shopId);

    if (body.full === true) {
      const hasil = await triggerFullSync(ctx.tenantId, shopId, ctx.userId);
      return successResponse({ message: 'Sinkronisasi penuh selesai.', hasil }, { requestId });
    }

    const result = await triggerOrderSync(ctx.tenantId, shopId, ctx.userId);
    return successResponse(
      { message: 'Sinkronisasi pesanan selesai.', syncRun: result },
      { requestId },
    );
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
