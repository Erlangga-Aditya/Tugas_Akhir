/**
 * Fase paket — satu-satunya tempat yang boleh menjawab "paket ini sudah di mana?".
 *
 * Kenapa dipisah dari status fulfillment: status fulfillment adalah catatan
 * PEKERJAAN GUDANG di aplikasi, sedangkan status kirim adalah catatan
 * KEBERADAAN PAKET di dunia nyata. Keduanya bisa berbeda — dan perbedaan itulah
 * yang dulu membuat scan resi paket in-transit meminta "tambah stok".
 *
 * Aturan: kalau paket sudah keluar gudang (dijemput kurir / dalam perjalanan /
 * diterima / gagal / dikembalikan), TIDAK ADA pekerjaan gudang yang tersisa.
 * Stok tidak boleh disentuh lagi.
 */

export type ParcelPhase =
  | 'BELUM_DIKIRIM' // belum ada pengiriman sama sekali
  | 'MENUNGGU_KURIR' // resi terbit, paket masih di gudang
  | 'DALAM_PERJALANAN' // sudah dijemput kurir / sedang menuju pembeli
  | 'DITERIMA' // sudah diterima pembeli
  | 'GAGAL' // gagal kirim, paket dalam proses kembali
  | 'DIKEMBALIKAN'; // paket sudah kembali ke gudang

export const PARCEL_PHASE_LABEL: Record<ParcelPhase, string> = {
  BELUM_DIKIRIM: 'Belum ada pengiriman',
  MENUNGGU_KURIR: 'Menunggu dijemput kurir',
  DALAM_PERJALANAN: 'Dalam perjalanan',
  DITERIMA: 'Diterima pembeli',
  GAGAL: 'Gagal kirim',
  DIKEMBALIKAN: 'Dikembalikan ke gudang',
};

/**
 * Fase paket ditentukan HANYA oleh status kirim. Status pesanan marketplace
 * boleh lebih baru (mis. SHIPPED) tetapi tidak boleh dipakai untuk menebak
 * keberadaan paket — status kirim yang menang.
 */
export function resolveParcelPhase(shipmentStatus: string | null | undefined): ParcelPhase {
  switch (shipmentStatus) {
    case 'PICKED_UP':
    case 'IN_TRANSIT':
      return 'DALAM_PERJALANAN';
    case 'DELIVERED':
      return 'DITERIMA';
    case 'FAILED':
      return 'GAGAL';
    case 'RETURNED':
      return 'DIKEMBALIKAN';
    case 'PENDING':
    case 'READY_TO_SHIP':
      return 'MENUNGGU_KURIR';
    default:
      return 'BELUM_DIKIRIM';
  }
}

/** true = paket sudah keluar gudang; tidak ada pekerjaan gudang & stok tersisa. */
export function parcelAlreadyLeft(phase: ParcelPhase): boolean {
  return phase === 'DALAM_PERJALANAN' || phase === 'DITERIMA' || phase === 'GAGAL' || phase === 'DIKEMBALIKAN';
}

/** Fase yang menuntut penutupan catatan fulfillment (paket jalan, catatan tertinggal). */
export function needsReconcile(phase: ParcelPhase): boolean {
  return parcelAlreadyLeft(phase);
}
