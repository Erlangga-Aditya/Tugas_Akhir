/**
 * Hitung mundur menuju batas kirim (ship-by) — dipakai untuk menandai pesanan
 * yang paling dekat dibatalkan otomatis oleh Shopee.
 *
 * Kenapa dipisah ke domain sendiri: aturan ini murni (tanpa I/O) sehingga bisa
 * diuji langsung, dan dipakai dua tempat sekaligus — daftar produksi dan
 * ringkasan "sisa waktu batal" di atasnya. Satu rumus, satu sumber kebenaran.
 */

export type NadaSisa = 'lewat' | 'kritis' | 'waspada' | 'aman';

export interface SisaWaktu {
  /** Kalimat siap tampil, mis. "Sisa 6 jam" atau "Lewat 3 jam". */
  teks: string;
  nada: NadaSisa;
  /** Selisih dalam jam (negatif = sudah lewat). Dibulatkan ke bawah. */
  jam: number;
}

const SEMENIT = 60_000;

function satuanMenit(menit: number): string {
  if (menit < 60) return `${Math.max(1, menit)} menit`;
  const jam = Math.floor(menit / 60);
  if (jam < 24) return `${jam} jam`;
  const hari = Math.floor(jam / 24);
  const sisaJam = jam % 24;
  return sisaJam === 0 ? `${hari} hari` : `${hari} hari ${sisaJam} jam`;
}

/**
 * Sisa waktu menuju batas kirim.
 *
 * Ambang (mengikuti perilaku Shopee yang sudah terverifikasi di produksi):
 *  - ≤ 0        → "Lewat …" (kritis: sudah bisa dibatalkan sistem)
 *  - < 1 jam    → menit, kritis
 *  - ≤ 24 jam   → kritis  (hari ini/besok dini hari sudah dibatalkan otomatis)
 *  - ≤ 72 jam   → waspada
 *  - > 72 jam   → aman
 *
 * Perhitungan dilakukan dalam MENIT lebih dulu. Kalau langsung dibulatkan ke
 * jam, sisa 45 menit akan terbaca "0 jam" dan salah dianggap sudah lewat.
 */
export function hitungSisaWaktu(
  batas: string | Date | null | undefined,
  now: Date = new Date(),
): SisaWaktu | null {
  if (!batas) return null;
  const waktu = batas instanceof Date ? batas.getTime() : new Date(batas).getTime();
  if (Number.isNaN(waktu)) return null;

  const selisihMenit = Math.trunc((waktu - now.getTime()) / SEMENIT);
  const jamBulat = Math.trunc(selisihMenit / 60);

  if (selisihMenit <= 0) {
    return { teks: `Lewat ${satuanMenit(Math.abs(selisihMenit))}`, nada: 'lewat', jam: jamBulat };
  }
  if (selisihMenit < 60) {
    return { teks: `Sisa ${selisihMenit} menit`, nada: 'kritis', jam: 0 };
  }
  if (jamBulat <= 24) {
    return { teks: `Sisa ${jamBulat} jam`, nada: 'kritis', jam: jamBulat };
  }
  if (jamBulat <= 72) {
    return { teks: `Sisa ${satuanMenit(selisihMenit)}`, nada: 'waspada', jam: jamBulat };
  }
  return { teks: `Sisa ${satuanMenit(selisihMenit)}`, nada: 'aman', jam: jamBulat };
}
