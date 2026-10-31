import { type NextRequest } from 'next/server';
import {
  getRekapKerjaStaf,
  getTahunTersedia,
} from '@/modules/reports/application/rekap-kerja-staf.usecase';
import {
  parseNomorMingguGaji,
  mingguGajiBerdasarkanTanggal,
  type NomorMingguGaji,
} from '@/modules/reports/domain/minggu-gaji';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId, assertPermission } from '@/shared/application/routeHelpers';
import { ValidationError } from '@/shared/errors/AppError';

/**
 * GET /api/v1/reports/rekap-kerja-staf?tahun=2026&bulan=10&minggu=2
 *
 * Rekap kerja staf per minggu gaji (tanggal tetap: 1–7, 8–14, 15–21, 22–akhir
 * bulan). Hanya untuk owner (page.reports). Data diambil dari jejak aksi yang
 * sudah tercatat di fulfillment_orders — read-only, tidak ada side-effect.
 *
 * Jika `minggu` tidak diberikan, default ke minggu yang sesuai dengan tanggal
 * hari ini. Nilai yang DIBERIKAN tetapi tidak valid ditolak (400), bukan
 * diam-diam diganti — supaya kesalahan pemanggil tidak tersamarkan.
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    assertPermission(ctx, 'page.reports');

    const params = new URL(request.url).searchParams;

    // Tahun yang punya catatan kerja — untuk dropdown tahun di UI. Dijalankan
    // bersamaan dengan pengambilan rekap, jadi tidak menambah round-trip.
    const tahunTersedia = getTahunTersedia(ctx.tenantId);

    const tahun = Number(params.get('tahun'));
    const bulan = Number(params.get('bulan'));
    if (!Number.isInteger(tahun) || tahun < 2000 || tahun > 2100) {
      throw new ValidationError('Tahun tidak valid. Contoh: ?tahun=2026');
    }
    if (!Number.isInteger(bulan) || bulan < 1 || bulan > 12) {
      throw new ValidationError('Bulan tidak valid. Contoh: ?bulan=10');
    }

    const mingguParam = params.get('minggu');
    let minggu: NomorMingguGaji;
    if (mingguParam !== null && mingguParam !== '') {
      const parsed = parseNomorMingguGaji(mingguParam);
      if (!parsed) throw new ValidationError('Minggu tidak valid. Pilih 1, 2, 3, atau 4.');
      minggu = parsed;
    } else {
      minggu = mingguGajiBerdasarkanTanggal(new Date()).minggu;
    }

    const [data, daftarTahun] = await Promise.all([
      getRekapKerjaStaf(ctx.tenantId, tahun, bulan, minggu),
      tahunTersedia,
    ]);
    return successResponse({ ...data, tahunTersedia: daftarTahun }, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
