/**
 * Pemetaan status PESANAN (marketplace) → status PAKET (tabel `shipments`).
 *
 * Kenapa modul ini ada — dan kenapa terpisah dari `mapLogisticsStatus`:
 * dulu satu fungsi dipakai untuk dua bahasa status yang berbeda. Akibatnya
 * status pesanan `CANCELLED` ikut dipetakan menjadi status paket `FAILED`,
 * sehingga setiap pesanan batal tampil di "Lacak Kiriman" sebagai
 * **Gagal kirim** dan di kartu pesanan sebagai badge merah "Gagal kirim".
 *
 * Keduanya bukan hal yang sama:
 *   - pesanan batal  = paket tidak pernah dikirim (tidak ada kegagalan kurir)
 *   - paket gagal    = paket keluar gudang lalu gagal diantar / hilang
 *
 * Aturan penting lainnya: fungsi ini mengembalikan `null` untuk status yang
 * TIDAK bisa disimpulkan, mis. `IN_CANCEL` (pembatalan baru diajukan, belum
 * diputuskan) atau status tak dikenal. `null` berarti "jangan menulis apa pun",
 * bukan "anggap di perjalanan" — versi lama memakai `IN_TRANSIT` sebagai
 * default, sehingga pesanan yang baru mengajukan batal dicap "dalam perjalanan".
 */

export type ShipmentStatusValue =
  | 'PENDING'
  | 'READY_TO_SHIP'
  | 'CANCELLED'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'FAILED'
  | 'RETURNED';

/**
 * Status pesanan → status paket.
 *
 * `null` = tidak ada kesimpulan yang jujur; pemanggil tidak boleh menulis
 * status paket apa pun untuk keadaan itu.
 */
export function mapOrderStatusToShipment(
  orderStatus: string | null | undefined,
): ShipmentStatusValue | null {
  switch ((orderStatus ?? '').toUpperCase()) {
    // Belum ada paket sama sekali: belum dibayar / menunggu pembayaran.
    case 'UNPAID':
    case 'PENDING':
      return null;

    // Pembatalan baru DIAJUKAN. Paket masih boleh jadi dikirim kalau pengajuan
    // ditolak/kedaluwarsa, jadi status paket tidak boleh dikunci jadi batal.
    case 'IN_CANCEL':
      return null;

    case 'READY_TO_SHIP':
    case 'PROCESSED':
    case 'RETRY_SHIP':
      return 'READY_TO_SHIP';

    case 'SHIPPED':
      return 'IN_TRANSIT';

    // `TO_CONFIRM_RECEIVE` = paket SUDAH sampai, tinggal konfirmasi penerimaan.
    case 'TO_CONFIRM_RECEIVE':
    case 'COMPLETED':
      return 'DELIVERED';

    // Pesanan batal → paket batal, BUKAN gagal kirim.
    case 'CANCELLED':
      return 'CANCELLED';

    case 'TO_RETURN':
    case 'RETURNED':
      return 'RETURNED';

    default:
      return null;
  }
}

/** Peringkat kemajuan paket. Semakin besar semakin jauh perjalanannya. */
const SHIPMENT_RANK: Record<string, number> = {
  PENDING: 0,
  READY_TO_SHIP: 1,
  PICKED_UP: 2,
  IN_TRANSIT: 3,
  DELIVERED: 4,
};

/**
 * Boleh tidaknya sebuah status paket diganti dengan status lain.
 *
 * Dua sumber memberi kabar status: status pesanan (`order_status`) dan status
 * pelacakan (`logistics_status`). Status hanya boleh MAJU, supaya kabar yang
 * tertinggal tidak menarik mundur paket yang sudah dijemput kurir.
 *
 * Pengecualian yang disengaja:
 *  - `FAILED` / `RETURNED` selalu berlaku (kejadian luar biasa).
 *  - `CANCELLED` hanya sah bila paket belum keluar gudang. Pembatalan pesanan
 *    setelah paket di jalan bukan pembatalan paket — itu jalur retur.
 */
export function shouldAdvanceShipmentStatus(current: string, next: string): boolean {
  if (next === 'CANCELLED') {
    return current === 'PENDING' || current === 'READY_TO_SHIP' || current === 'CANCELLED';
  }
  // Setelah batal, tidak ada kabar yang boleh "menghidupkan" paket ini lagi.
  if (current === 'CANCELLED') return false;
  if (next === 'FAILED' || next === 'RETURNED') return true;
  // Sekali gagal/dikembalikan, jangan digeser mundur oleh kabar yang tertinggal.
  if (current === 'FAILED' || current === 'RETURNED') return false;
  const a = SHIPMENT_RANK[current];
  const b = SHIPMENT_RANK[next];
  if (a === undefined || b === undefined) return true;
  return b >= a;
}

/** Status paket yang berarti paket sudah keluar gudang (bukan lagi urusan gudang). */
export const SHIPMENT_LEFT_WAREHOUSE: ReadonlySet<string> = new Set([
  'PICKED_UP',
  'IN_TRANSIT',
  'DELIVERED',
  'FAILED',
  'RETURNED',
]);

/** Status paket yang tidak akan berubah lagi. */
export const SHIPMENT_TERMINAL: ReadonlySet<string> = new Set([
  'DELIVERED',
  'FAILED',
  'RETURNED',
  'CANCELLED',
]);
