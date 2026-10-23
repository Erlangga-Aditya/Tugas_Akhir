/**
 * Kode batch cetak produksi + deteksi cetak ulang (anti produksi ganda).
 *
 * Aturan deteksi: dua cetakan dianggap SAMA bila berisi himpunan pesanan yang
 * identik dan terjadi pada hari kalender yang sama. Cetakan pertama yang
 * tercatat adalah "batch" resmi; cetakan berikutnya hanya diperingatkan, tidak
 * membuat baris baru — supaya tim produksi tidak mengerjakan dua kali pesanan
 * yang sama hanya karena lembar kerjanya dicetak dua kali.
 */

/** Identitas isi cetakan: orderId unik, terurut, digabung `|`. */
export function kunciCetak(orderIds: readonly string[]): string {
  return [...new Set(orderIds)].sort().join('|');
}

export function identitasCetakSama(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b && a === b);
}

/** `PROD-20261022-1` — urutan 1 = cetakan resmi pertama hari itu. */
export function buatKodeBatch(tanggal: Date, urutan: number): string {
  const ymd = [
    tanggal.getFullYear(),
    String(tanggal.getMonth() + 1).padStart(2, '0'),
    String(tanggal.getDate()).padStart(2, '0'),
  ].join('');
  return `PROD-${ymd}-${urutan}`;
}

/** Awal hari kalender lokal server (dipakai sebagai batas "hari yang sama"). */
export function awalHari(tanggal: Date): Date {
  return new Date(tanggal.getFullYear(), tanggal.getMonth(), tanggal.getDate());
}
