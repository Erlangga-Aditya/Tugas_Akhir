/**
 * Kategori "perlu perhatian" pada pesanan: pembatalan & keterlambatan.
 *
 * Sumber kebenaran istilah (Shopee Open Platform v2):
 *  - `order_status` = `IN_CANCEL` → pembatalan **diajukan** (belum final).
 *  - `cancel_by` hanya bernilai `buyer` | `seller` | `system` | `Ops`
 *    (docs `get_order_detail`, field opsional `cancel_by`).
 *  - `cancel_reason` berisi kode alasan; contoh nyata dari dokumentasi:
 *    `BACKEND_LOGISTICS_NOT_STARTED` — batal otomatis karena paket belum
 *    diserahkan ke kurir sampai batas waktu.
 *  - `ship_by_date` = tenggat penjual harus menyerahkan paket.
 *
 * Semua aturan di berkas ini MURNI (tanpa I/O) supaya bisa diuji dan dipakai
 * bersama oleh server (kartu & filter) dan UI (label pada kartu pesanan).
 */

/** Pelaku pembatalan menurut marketplace. */
export type CancelActor = 'buyer' | 'seller' | 'system' | 'ops' | 'unknown';

/** Kategori pembatalan yang ditampilkan sebagai kartu/penanda. */
export type CancelCategory =
  | 'DIAJUKAN' // IN_CANCEL — masih bisa ditanggapi
  | 'DIBATALKAN_PEMBELI'
  | 'DIBATALKAN_PENJUAL'
  | 'DIBATALKAN_SISTEM';

/**
 * Kelompok "perlu perhatian" yang bisa disaring di halaman Pesanan.
 * `pembatalan` & `batalSistem` memakai tanggal kejadian; sisanya memakai
 * tenggat `ship_by_date`.
 */
export type ExceptionKategori = 'pembatalan' | 'batalSistem' | 'terlambat' | 'besokBatal' | 'beresiko';

export const EXCEPTION_KATEGORI: readonly ExceptionKategori[] = [
  'pembatalan',
  'batalSistem',
  'terlambat',
  'besokBatal',
  'beresiko',
] as const;

export function isExceptionKategori(value: string | null | undefined): value is ExceptionKategori {
  return typeof value === 'string' && (EXCEPTION_KATEGORI as readonly string[]).includes(value);
}

/**
 * Apakah pembatalan oleh sistem ini PERLU PERHATIAN OPERASIONAL?
 *
 * Shopee membatalkan otomatis karena banyak sebab. Dua yang paling sering:
 *  - pembeli tidak membayar (`Unpaid Order`) — bukan kegagalan gudang, dan
 *    tidak bisa dicegah operator;
 *  - paket tidak diserahkan ke kurir sampai tenggat
 *    (`BACKEND_LOGISTICS_NOT_STARTED`, dsb.) — inilah yang harus terlihat,
 *    karena menandakan proses gudang/penjualan yang terlambat.
 *
 * Tanpa pemisahan ini, kartu "Batal oleh Sistem" penuh pesanan belum bayar dan
 * sinyal keterlambatannya tenggelam.
 */
export function isSystemCancelNeedsAttention(cancelReason: string | null | undefined): boolean {
  const alasan = (cancelReason ?? '').trim().toUpperCase();
  if (!alasan) return true; // tanpa alasan tercatat → tetap tampilkan
  if (alasan.includes('UNPAID')) return false;
  return true;
}

/** Risiko keterlambatan paket. */
export type LateRisk = 'TIDAK_RELEVAN' | 'AMAN' | 'BERESIKO' | 'BESOK_BATAL' | 'TERLAMBAT';

export const CANCEL_ACTOR_LABEL: Record<CancelActor, string> = {
  buyer: 'Pembeli',
  seller: 'Penjual',
  system: 'Sistem Shopee',
  ops: 'Shopee (Ops)',
  unknown: 'Tidak diketahui',
};

export const CANCEL_CATEGORY_LABEL: Record<CancelCategory, string> = {
  DIAJUKAN: 'Pembatalan diajukan',
  DIBATALKAN_PEMBELI: 'Dibatalkan pembeli',
  DIBATALKAN_PENJUAL: 'Dibatalkan penjual',
  DIBATALKAN_SISTEM: 'Dibatalkan sistem',
};

export const LATE_RISK_LABEL: Record<LateRisk, string> = {
  TIDAK_RELEVAN: '',
  AMAN: 'Tepat waktu',
  BERESIKO: 'Beresiko terlambat',
  BESOK_BATAL: 'Besok batal',
  TERLAMBAT: 'Terlambat',
};

/** Status Shopee yang masih menuntut penjual menyerahkan paket. */
const STATUS_MASIH_HARUS_KIRIM = new Set(['READY_TO_SHIP', 'PROCESSED', 'RETRY_SHIP']);

const SATU_HARI_MS = 24 * 60 * 60 * 1000;
const TIGA_HARI_MS = 3 * SATU_HARI_MS;

export function resolveCancelActor(cancelBy: string | null | undefined): CancelActor {
  switch ((cancelBy ?? '').trim().toLowerCase()) {
    case 'buyer':
      return 'buyer';
    case 'seller':
      return 'seller';
    case 'system':
      return 'system';
    case 'ops':
      return 'ops';
    default:
      return 'unknown';
  }
}

/**
 * Kategori pembatalan. `null` = pesanan ini tidak sedang/ sudah dibatalkan.
 * Catatan: `IN_CANCEL` adalah pengajuan; pelakunya belum tentu pembeli, jadi
 * labelnya "Pembatalan diajukan" — bukan "dibatalkan".
 */
export function resolveCancelCategory(input: {
  externalStatus: string | null | undefined;
  cancelBy?: string | null;
}): CancelCategory | null {
  const status = (input.externalStatus ?? '').toUpperCase();
  if (status === 'IN_CANCEL') return 'DIAJUKAN';
  if (status !== 'CANCELLED') return null;

  switch (resolveCancelActor(input.cancelBy)) {
    case 'buyer':
      return 'DIBATALKAN_PEMBELI';
    case 'seller':
      return 'DIBATALKAN_PENJUAL';
    case 'system':
    case 'ops':
      return 'DIBATALKAN_SISTEM';
    default:
      // Pesanan batal tanpa jejak pelaku (data lama sebelum kolom cancel_by
      // ada). Jangan menebak "sistem" — tampilkan sebagai tidak diketahui.
      return 'DIBATALKAN_PEMBELI';
  }
}

/**
 * Risiko keterlambatan berdasarkan tenggat `ship_by_date`.
 *
 * Padanan label Seller Centre:
 *  - `READY_TO_SHIP` dengan tenggat ≤ 24 jam  → **Besok Batal** (akan
 *    dibatalkan otomatis jika belum diatur pengirimannya).
 *  - `PROCESSED` (resi sudah ada, menunggu penjemputan) yang mendekati/melewati
 *    tenggat → **Beresiko Terlambat** (Shopee menunggu verifikasi jasa kirim).
 *  - tenggat sudah lewat → **Terlambat**.
 */
export function resolveLateRisk(input: {
  externalStatus: string | null | undefined;
  shipByAt: Date | null | undefined;
  now?: Date;
}): LateRisk {
  const status = (input.externalStatus ?? '').toUpperCase();
  if (!STATUS_MASIH_HARUS_KIRIM.has(status)) return 'TIDAK_RELEVAN';
  if (!input.shipByAt) return 'TIDAK_RELEVAN';

  const now = input.now ?? new Date();
  const sisa = input.shipByAt.getTime() - now.getTime();

  if (sisa <= 0) return 'TERLAMBAT';
  if (sisa <= SATU_HARI_MS) return status === 'READY_TO_SHIP' ? 'BESOK_BATAL' : 'BERESIKO';
  if (sisa <= TIGA_HARI_MS) return 'BERESIKO';
  return 'AMAN';
}

/** true = pesanan ini masuk salah satu kartu "keterlambatan". */
export function isLateWatch(risk: LateRisk): boolean {
  return risk === 'TERLAMBAT' || risk === 'BESOK_BATAL' || risk === 'BERESIKO';
}
