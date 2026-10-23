/**
 * Aturan "boleh-tidaknya" menyetujui pembatalan yang diajukan pembeli.
 *
 * Fakta yang mengikat (Shopee Open Platform v2):
 *  - Status pengajuan = `order_status = IN_CANCEL`; setelah disetujui menjadi
 *    `CANCELLED` dengan `cancel_by = seller` (bawaan `order/cancel_order`).
 *  - Tidak ada endpoint untuk MENOLAK pembatalan pembeli → keputusan produk:
 *    tombol tolak tidak ditampilkan, penolakan dilakukan di Seller Centre.
 *  - Hanya OWNER yang boleh menyetujui (keputusan pemilik toko), karena efeknya
 *    mengubah status pesanan di marketplace dan melepas stok.
 *
 * Fungsi ini SENGAJA murni: tidak menyentuh database maupun HTTP, supaya aturan
 * yang sama dipakai server (penjaga terakhir) dan UI (menampilkan tombol).
 */

export type CancelApprovalRole = 'OWNER' | 'STAFF';

export type CancelApprovalBlock =
  | 'BUKAN_OWNER'
  | 'BUKAN_PENGAJUAN'
  | 'SUDAH_FINAL'
  | 'PAKET_SUDAH_JALAN';

export type CancelApprovalCheck =
  | { ok: true }
  | { ok: false; reason: CancelApprovalBlock; message: string };

export const ALASAN_TOLAK_SETUJUI: Record<CancelApprovalBlock, string> = {
  BUKAN_OWNER: 'Hanya pemilik toko (OWNER) yang boleh menyetujui pembatalan.',
  BUKAN_PENGAJUAN: 'Pesanan ini tidak sedang mengajukan pembatalan.',
  SUDAH_FINAL: 'Pesanan sudah dibatalkan atau selesai — tidak ada yang perlu disetujui.',
  PAKET_SUDAH_JALAN:
    'Paket sudah dijemput kurir / dalam perjalanan. Pembatalan tidak bisa disetujui dari aplikasi; ' +
    'selesaikan lewat Seller Centre.',
};

/** Status kirim yang berarti paket sudah keluar gudang. */
const PAKET_KELUAR = new Set(['PICKED_UP', 'IN_TRANSIT', 'DELIVERED']);

export function checkCancelApproval(input: {
  role: CancelApprovalRole;
  externalStatus: string | null | undefined;
  orderStatus: string;
  shipmentStatus?: string | null;
}): CancelApprovalCheck {
  if (input.role !== 'OWNER') {
    return { ok: false, reason: 'BUKAN_OWNER', message: ALASAN_TOLAK_SETUJUI.BUKAN_OWNER };
  }
  if (input.orderStatus === 'CANCELLED' || input.orderStatus === 'COMPLETED') {
    return { ok: false, reason: 'SUDAH_FINAL', message: ALASAN_TOLAK_SETUJUI.SUDAH_FINAL };
  }
  if ((input.externalStatus ?? '').toUpperCase() !== 'IN_CANCEL') {
    return { ok: false, reason: 'BUKAN_PENGAJUAN', message: ALASAN_TOLAK_SETUJUI.BUKAN_PENGAJUAN };
  }
  if (PAKET_KELUAR.has((input.shipmentStatus ?? '').toUpperCase())) {
    return { ok: false, reason: 'PAKET_SUDAH_JALAN', message: ALASAN_TOLAK_SETUJUI.PAKET_SUDAH_JALAN };
  }
  return { ok: true };
}
