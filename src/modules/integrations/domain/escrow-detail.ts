/**
 * Pembaca respons escrow (rincian dana) dari Shopee.
 *
 * MASALAH YANG DISELESAIKAN
 * -------------------------
 * `v2.payment.get_escrow_detail_batch` tidak selalu membalut hasilnya di objek
 * dengan kunci tetap. Bentuk yang benar-benar diterima Shopee (terbukti dari
 * log produksi: kunci respons `0, 1, 2, … 10`) adalah **array langsung** di
 * dalam `response`. Versi lama hanya mencoba `res.order_income_list` dan
 * beberapa kunci objek lain, sehingga rincian biaya selalu terbaca "kosong" —
 * akibatnya kartu "Estimasi dana masuk" dan "Potongan Shopee" tidak pernah
 * terisi aunque Seller Centre menampilkannya.
 *
 * Modul ini karena itu TIDAK menebak bentuk respons. Ia mencoba semua bentuk
 * yang memang dipakai Shopee, secara terstruktur, dan mencatat apa adanya
 * bentuk yang ditemukan supaya masalah serupa bisa ditelusuri di log.
 */

/** Kunci yang pernah dipakai Shopee untuk membungkus daftar rincian dana. */
const LIST_KEYS = [
  'order_income_list',
  'order_income_info',
  'escrow_list',
  'escrow_detail_list',
  'order_list',
  'response',
] as const;

/** Kunci yang pernah dipakai Shopee untuk membungkus rincian dana satu pesanan. */
const INCOME_KEYS = ['order_income', 'escrow', 'income', 'order_income_detail'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Ambil daftar baris rincian dana dari respons apa pun bentuknya.
 * Mengembalikan array kosong kalau tidak ada baris yang bisa dibaca.
 */
export function extractEscrowList(res: unknown): Array<Record<string, unknown>> {
  // Bentuk 1: respons adalah array langsung.
  if (Array.isArray(res)) {
    return res.filter(isRecord);
  }
  if (!isRecord(res)) return [];

  // Bentuk 2: salah satu kunci membungkus array.
  for (const key of LIST_KEYS) {
    const value = res[key];
    if (Array.isArray(value)) {
      const rows = value.filter(isRecord);
      if (rows.length > 0) return rows;
    }
  }

  // Bentuk 2b: respons ter-serialize jadi objek berkunci indeks ("0", "1", ...).
  // Inilah bentuk yang benar-benar diterima dari Shopee (bukti: log produksi).
  const numericKeys = Object.keys(res).filter((k) => /^\d+$/.test(k));
  if (numericKeys.length > 0) {
    const rows = numericKeys
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => res[k])
      .filter(isRecord);
    if (rows.length > 0) return rows;
  }

  // Bentuk 3: satu pesanan tanpa pembungkus list.
  if (extractIncome(res)) {
    return [res];
  }
  return [];
}

/** Ambil objek rincian dana dari satu baris, apa pun kunci yang dipakainya. */
export function extractIncome(row: Record<string, unknown>): Record<string, unknown> | null {
  for (const key of INCOME_KEYS) {
    const value = row[key];
    if (isRecord(value)) return value;
  }
  // Beberapa versi Shopee menaruh angkanya langsung di baris teratas.
  if ('escrow_amount' in row || 'commission_fee' in row || 'order_selling_price' in row) {
    return row;
  }
  return null;
}

/**
 * Ringkasan singkat bentuk respons untuk pesan log.
 * Sengaja tidak mencetak nilai uang (data klien) — hanya nama kunci/jumlah.
 */
export function describeShape(res: unknown): string {
  if (Array.isArray(res)) {
    return `array langsung berisi ${res.length} baris`;
  }
  if (!isRecord(res)) return `tipe tidak dikenal (${typeof res})`;
  const keys = Object.keys(res);
  if (keys.length === 0) return 'objek kosong';
  // Kunci numerik menandakan array yang ter-serialize jadi objek.
  if (keys.every((k) => /^\d+$/.test(k))) {
    return `objek dengan kunci indeks (${keys.length} baris) — kemungkinan array yang tidak dibungkus`;
  }
  return `objek dengan kunci: ${keys.slice(0, 6).join(', ')}`;
}
