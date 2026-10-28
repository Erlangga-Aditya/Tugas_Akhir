/**
 * Kapan catatan fulfillment (antrean kerja gudang) boleh dibuat otomatis?
 *
 * Aturan ini dipisahkan dari usecase supaya bisa diuji tanpa database, dan
 * supaya sinkronisasi pesanan, webhook, dan tombol manual memakai definisi yang
 * sama.
 *
 * Kenapa perlu: versi lama hanya membuat catatan fulfillment ketika pesanan
 * BARU SAJA diimpor (`result.created`). Akibatnya pesanan yang sudah ada di
 * database lalu berubah menjadi siap dikerjakan (mis. `UNPAID` → `READY_TO_SHIP`
 * setelah pembeli membayar) tidak pernah mendapat catatan fulfillment. Pesanan
 * itu tampil di halaman Pesanan sebagai "Pesanan Baru" tanpa antrean kerja,
 * sehingga tidak pernah muncul di daftar produksi dan tidak ikut dihitung
 * sebagai pekerjaan — sampai seseorang menekan "Proses ke Fulfillment" manual.
 */

export interface FulfillmentGateInput {
  /** `orders.status` internal. */
  orderStatus: string;
  /** Status paket terbaru (`shipments.status`), `null` bila belum ada. */
  shipmentStatus?: string | null;
  /** true = sudah ada catatan fulfillment yang masih aktif (bukan final). */
  hasActiveFulfillment: boolean;
}

export type FulfillmentGateResult =
  | { shouldCreate: true }
  | { shouldCreate: false; reason: string };

/** Paket yang sudah keluar gudang: tidak ada pekerjaan gudang yang tersisa. */
const PAKET_SUDAH_KELUAR = new Set(['PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'RETURNED']);

export function shouldCreateFulfillmentRecord(input: FulfillmentGateInput): FulfillmentGateResult {
  if (input.hasActiveFulfillment) {
    return { shouldCreate: false, reason: 'Catatan fulfillment sudah ada.' };
  }

  if (input.orderStatus !== 'CONFIRMED') {
    return {
      shouldCreate: false,
      reason:
        input.orderStatus === 'CANCELLED'
          ? 'Pesanan sudah dibatalkan.'
          : `Pesanan berstatus ${input.orderStatus} — belum siap dikerjakan gudang.`,
    };
  }

  // Paket yang sudah dijemput kurir / sudah diterima tidak boleh memunculkan
  // antrean kerja baru: barangnya nyata-nyata sudah keluar gudang, dan
  // permintaan stok di layar hanya akan menyesatkan operator.
  const paket = (input.shipmentStatus ?? '').toUpperCase();
  if (PAKET_SUDAH_KELUAR.has(paket)) {
    return {
      shouldCreate: false,
      reason: `Paket sudah keluar gudang (${paket}) — tidak ada pekerjaan gudang tersisa.`,
    };
  }

  return { shouldCreate: true };
}
