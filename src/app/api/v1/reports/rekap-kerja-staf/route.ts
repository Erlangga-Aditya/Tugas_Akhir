import { type NextRequest } from 'next/server';
import { getRekapKerjaStaf, getTahunTersedia } from '@/modules/reports/application/rekap-kerja-staf.usecase';
import { parseNomorMingguGaji, mingguGajiBerdasarkanTanggal } from '@/modules/reports/domain/minggu-gaji';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId, assertPermission } from '@/shared/application/routeHelpers';

/**
 * GET /api/v1/reports/rekap-kerja-staf?tahun=2026&bulan=10&minggu=2
 *
 * Rekap kerja staf per minggu gaji (tanggal tetap: 1–7, 8–14, 15–21, 22–akhir
 * bulan). Hanya untuk owner (page.reports). Data diambil dari jejak aksi yang
 * sudah tercatat di fulfillment_orders — read-only, tidak ada side-effect.
 *
 * Jika `minggu` tidak diberikan, default ke minggu yang sesuai dengan tanggal
 * hari ini.
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    assertPermission(ctx, 'page.reports');

    const params = new URL(request.url).searchParams;

    const tahunParam = params.get('tahun');
    const bulanParam = params.get('bulan');
    const mingguParam = params.get('minggu');

    // Ambil tahun yang punya catatan kerja (untuk dropdown tahun di UI).
    // Dijalankan bersamaan dengan pengambilan rekap — tidak menambah round-trip
    // yang dirasakan pemanggil.
    const tahunTersedia = getTahunTersedia(ctx.tenantId);

    // Validasi tahun & bulan — harus angka utuh, bukan coyote string.
    const tahun = Number(tahunParam);
    const bulan = Number(bulanParam);
    if (!Number.isInteger(tahun) || tahun < 2000 || tahun > 2100) {
      return successResponse(
        { error: 'Tahun tidak valid. Contoh: ?tahun=2026' },
        { requestId, status: 400 },
      );
    }
    if (!Number.isInteger(bulan) || bulan < 1 || bulan > 12) {
      return successResponse(
        { error: 'Bulan tidak valid. Contoh: ?bulan=10' },
        { requestId, status: 400 },
      );
    }

    // Jika minggu tidak diberikan / tidak valid, pakai minggu hari ini.
    // parseNomorMingguGaji mengembalikan angka asli (bukan string) — penting
    // karena perhitungan rentang di domain melakukan aritmetika `minggu + 1`.
    const mingguParsed = parseNomorMingguGaji(mingguParam);
    const minggu = mingguParsed ?? mingguGajiBerdasarkanTanggal(new Date()).minggu;

    const [data, daftarTahun] = await Promise.all([
      getRekapKerjaStaf(ctx.tenantId, tahun, bulan, minggu),
      tahunTersedia,
    ]);
    return successResponse({ ...data, tahunTersedia: daftarTahun }, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
