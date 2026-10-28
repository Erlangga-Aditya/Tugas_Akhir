/**
 * Minggu gaji: cara toko memotong bulan menjadi 4 minggu kerja.
 *
 * Potongannya **tanggal tetap**, bukan minggu kalender yang bergeser:
 *   Minggu 1 = tanggal 1–7
 *   Minggu 2 = tanggal 8–14
 *   Minggu 3 = tanggal 15–21
 *   Minggu 4 = tanggal 22 sampai akhir bulan (bisa 8–9 hari)
 *
 * Alasan memilih tanggal tetap (bukan Senin–Minggu): penggajian butuh
 * rentang yang stabil & bisa diprediksi. Tanggal 1 selalu jatuh di
 * minggu 1, dan minggu 4 selalu menutup bulan tersebut — tidak ada
 * minggu parsial yang melewati bulan lain.
 *
 * Semua batas dihitung pada zona waktu **WIB (UTC+7)**, memakai
 * `startOfWibDay` yang sudah ada, supaya jam 00:30 WIB tetap
 * terhitung sebagai hari yang benar bukan hari sebelumnya (UTC).
 * Rentang selalu setengah-terbuka `[from, to)`.
 */

import { startOfWibDay } from '../../fulfillment/domain/date-range';

/** Nomor minggu gaji dalam sebulan: 1, 2, 3, atau 4. */
export type NomorMingguGaji = 1 | 2 | 3 | 4;

export const NOMOR_MINGGU_GAJI: readonly NomorMingguGaji[] = [1, 2, 3, 4] as const;

/** Tanggal awal setiap potongan minggu (tanggal akhir = awal minggu depan − 1). */
const AWAL_MINGGU: Record<NomorMingguGaji, number> = {
  1: 1,
  2: 8,
  3: 15,
  4: 22,
};

export interface RentangMingguGaji {
  /** Awal minggu, 00:00 WIB (sebagai instant UTC). */
  from: Date;
  /** Akhir minggu (eksklusif), 00:00 WIB hari setelah minggu berakhir. */
  to: Date;
  /** Nomor minggu dalam bulan. */
  minggu: NomorMingguGaji;
  /** Tanggal awal untuk tampilan (contoh: 8). */
  tanggalAwal: number;
  /** Tanggal akhir untuk tampilan (contoh: 14). */
  tanggalAkhir: number;
  /** Bulan (1–12). */
  bulan: number;
  /** Tahun (contoh: 2026). */
  tahun: number;
}

/**
 * Parse parameter query menjadi nomor minggu gaji.
 *
 * Mengembalikan angka asli (bukan string mentahnya) — penting karena
 * `selesaikanMingguGaji` melakukan aritmetika `minggu + 1`; kalau yang
 * lewat masih string, `'2' + 1` menjadi `'21'` dan merusak seluruh
 * perhitungan rentang secara senyap.
 */
export function parseNomorMingguGaji(value: string | number | null | undefined): NomorMingguGaji | null {
  if (value === null || value === undefined) return null;
  const angka = Number(value);
  return (NOMOR_MINGGU_GAJI as readonly number[]).includes(angka) ? (angka as NomorMingguGaji) : null;
}

export function isNomorMingguGaji(value: string | number | null | undefined): value is NomorMingguGaji {
  return parseNomorMingguGaji(value) !== null;
}

/** Jumlah hari dalam bulan tertentu (1–12) pada tahun tertentu. */
export function jumlahHariDalamBulan(tahun: number, bulan: number): number {
  // Tanggal 0 dari bulan berikutnya = hari terakhir bulan ini.
  // Bulan di sini 1–12, sedangkan Date.UTC memakai 0–11.
  return new Date(Date.UTC(tahun, bulan, 0)).getUTCDate();
}

/**
 * Selesaikan nomor minggu & bulan/tahun menjadi rentang nyata.
 *
 * `now` tidak dipakai di sini (tidak diperlukan — semua tanggal mutlak),
 * tetapi dipertahankan sebagai parameter opsional supaya pemanggil tetap
 * bisa menguji fungsi ini relatif terhadap waktu tertentu jika nanti
 * diperlukan. Lihat `mingguGajiBerdasarkanTanggal` untuk kebalikannya.
 */
export function selesaikanMingguGaji(
  tahun: number,
  bulan: number,
  minggu: NomorMingguGaji,
): RentangMingguGaji {
  const tanggalAwal = AWAL_MINGGU[minggu];
  const tanggalAkhir =
    minggu === 4
      ? jumlahHariDalamBulan(tahun, bulan)
      : AWAL_MINGGU[(minggu + 1) as NomorMingguGaji] - 1;

  // Batas bawah: 00:00 WIB tanggal awal.
  const from = startOfWibDay(new Date(Date.UTC(tahun, bulan - 1, tanggalAwal)));

  // Batas atas (eksklusif): 00:00 WIB hari setelah tanggal akhir.
  // Untuk minggu 4, `tanggalAkhir + 1` = tanggal 1 bulan berikutnya,
  // yang otomatis merupakan awal bulan depan karena Date.UTC
  // merapatkan bulan yang lebih besar dari 11 ke tahun depan.
  const to = startOfWibDay(new Date(Date.UTC(tahun, bulan - 1, tanggalAkhir + 1)));

  return { from, to, minggu, tanggalAwal, tanggalAkhir, bulan, tahun };
}

/**
 * Cari minggu gaji yang memuat `tanggal` tertentu.
 * Dipakai untuk menentukan minggu aktif saat halaman pertama dibuka.
 */
export function mingguGajiBerdasarkanTanggal(tanggal: Date): RentangMingguGaji {
  // Ambil tanggal & bulan dalam WIB.
  const wib = new Date(tanggal.getTime() + 7 * 60 * 60 * 1000);
  const tahun = wib.getUTCFullYear();
  const bulan = wib.getUTCMonth() + 1;
  const hari = wib.getUTCDate();

  const minggu: NomorMingguGaji = hari <= 7 ? 1 : hari <= 14 ? 2 : hari <= 21 ? 3 : 4;
  return selesaikanMingguGaji(tahun, bulan, minggu);
}
