import { type NextRequest } from 'next/server';
import { getFulfillmentStation } from '@/modules/fulfillment/application/fulfillment.usecase';
import { isQueueBucket } from '@/modules/fulfillment/domain/work-queue';
import { isExceptionKategori } from '@/modules/fulfillment/domain/order-exceptions';
import { isRangePreset, resolveRangePreset } from '@/modules/fulfillment/domain/date-range';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import {
  getAuthContext,
  getRequestId,
  getQueryParam,
  parsePagination,
  assertPermission,
} from '@/shared/application/routeHelpers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/fulfillment/station
 *
 * Satu endpoint untuk halaman "Pesanan & Pengiriman": daftar pesanan pada
 * rentang tanggal tertentu + tiga angka ringkasan yang tampil sebagai kartu.
 *
 * Parameter:
 *   ?range=today|yesterday|last7|last30|all   (default: all)
 *   ?bucket=baru|sudahResi|perluDiproses|semua (default: perluDiproses)
 *   ?sort=oldest|newest
 *   ?search=<nomor pesanan | nomor resi | nama pembeli | SKU>
 *   ?page=1&pageSize=20
 *
 * Angka kartu (`kartu`) SELALU dihitung dari seluruh pesanan pada rentang itu,
 * bukan dari halaman yang tampil, sehingga tidak berubah saat operator
 * berpindah halaman.
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    assertPermission(ctx, 'page.orders');
    const sortParam = getQueryParam(request, 'sort');
    const { page, pageSize } = parsePagination(request);

    // Nilai yang tidak dikenal diabaikan ke default yang aman, bukan diteruskan:
    // permintaan salah tidak boleh menghasilkan daftar yang berbeda diam-diam.
    const rangeParam = getQueryParam(request, 'range');
    const preset = isRangePreset(rangeParam) ? rangeParam : 'all';
    const bucketParam = getQueryParam(request, 'bucket');
    const kategoriParam = getQueryParam(request, 'kategori');
    const bucket = isQueueBucket(bucketParam) ? bucketParam : 'perluDiproses';

    const station = await getFulfillmentStation(ctx.tenantId, {
      sort: sortParam === 'newest' ? 'newest' : 'oldest',
      bucket,
      range: resolveRangePreset(preset, new Date()),
      search: getQueryParam(request, 'search'),
      ...(isExceptionKategori(kategoriParam) ? { kategori: kategoriParam } : {}),
      page,
      pageSize,
    });

    // Izin yang dibutuhkan UI, dihitung server. UI tidak boleh menebak dari
    // peran yang disimpannya sendiri — server tetap penjaga terakhir.
    return successResponse(
      { ...station, rangePreset: preset, izin: { setujuiPembatalan: ctx.role === 'OWNER' } },
      { requestId },
    );
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
