import { type NextRequest } from 'next/server';
import { reconcileShippedOrders } from '@/modules/fulfillment/application/reconcile-shipped.usecase';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId, assertPermission } from '@/shared/application/routeHelpers';

/**
 * POST /api/v1/fulfillment/reconcile-shipped
 *
 * Menutup catatan fulfillment untuk paket yang SUDAH keluar gudang
 * (dijemput kurir / transit / diterima / gagal / kembali). Pesanan seperti ini
 * bisa muncul kalau penjual mengirim lewat Seller Centre tanpa melewati layar
 * packing aplikasi; catatannya tertinggal di "menunggu stok" sehingga scan resi
 * berhenti di pemeriksaan stok dan menampilkan "harus tambah stok".
 *
 * Body: `{ "apply": false }` (default) = hanya menghitung, tidak mengubah apa pun.
 *       `{ "apply": true }`            = tutup + potong stok susulan (maks 1x).
 *
 * Aman diulang: penutupan memakai kunci status, dan stok hanya dipotong untuk
 * baris yang `fulfilledQuantity`-nya belum penuh.
 */
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    assertPermission(ctx, 'order.pick');

    const body = (await request.json().catch(() => ({}))) as { apply?: boolean };
    const hasil = await reconcileShippedOrders(ctx.tenantId, {
      apply: body.apply === true,
      actorId: ctx.userId,
    });

    return successResponse(hasil, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId);
  }
}
