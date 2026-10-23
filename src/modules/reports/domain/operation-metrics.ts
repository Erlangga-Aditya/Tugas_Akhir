/**
 * Metrik operasional gudang untuk owner.
 *
 * Dipakai di halaman Laporan, jadi aturannya murni & mudah diuji: pemetaan
 * status pekerjaan ke tahap yang dipahami manusia, serta penjumlahan paket
 * per pelaku (dasar pembayaran packer & kurir internal).
 *
 * Catatan penting soal tanggal:
 *  - Tahap yang MASIH BERJALAN (perlu produksi, siap diambil, sedang dipacking,
 *    siap diserahkan) dihitung dari keadaan sekarang — bukan dari riwayat.
 *  - Tahap yang SUDAH TERJADI (dipacking, diserahkan, diterima kurir) disaring
 *    memakai tanggal kejadiannya, supaya filter "hari ini" benar-benar berarti
 *    "apa yang terjadi hari ini".
 */

export const TAHAP_OPERASIONAL = {
  perluProduksi: 'Perlu Produksi',
  siapDiambil: 'Siap Diambil',
  sedangDipacking: 'Sedang Dipacking',
  siapDiserahkan: 'Siap Diserahkan',
  sudahDiserahkan: 'Diserahkan ke Kurir',
  diterimaShopee: 'Diterima Kurir Shopee',
  gagal: 'Gagal / Tertahan',
} as const;

export type TahapOperasional = keyof typeof TAHAP_OPERASIONAL;

/** Status pekerjaan gudang → tahap yang dilihat owner. */
const PETA_TAHAP: Record<string, TahapOperasional> = {
  WAITING_STOCK: 'perluProduksi',
  READY_TO_PICK: 'siapDiambil',
  PICKING: 'sedangDipacking',
  PICKED: 'sedangDipacking',
  PACKING: 'sedangDipacking',
  PACKED: 'siapDiserahkan',
  READY_TO_SHIP: 'siapDiserahkan',
  HANDED_OVER: 'sudahDiserahkan',
  EXCEPTION: 'gagal',
};

export function tahapDariStatus(status: string): TahapOperasional | null {
  return PETA_TAHAP[status] ?? null;
}

export type HitunganTahap = Record<TahapOperasional, number>;

export function hitungTahap(statuses: readonly string[]): HitunganTahap {
  const hasil: HitunganTahap = {
    perluProduksi: 0,
    siapDiambil: 0,
    sedangDipacking: 0,
    siapDiserahkan: 0,
    sudahDiserahkan: 0,
    diterimaShopee: 0,
    gagal: 0,
  };
  for (const s of statuses) {
    const tahap = tahapDariStatus(s);
    if (tahap) hasil[tahap] += 1;
  }
  return hasil;
}

export interface PaketPerPelaku {
  id: string;
  nama: string;
  jumlah: number;
}

/**
 * Menjumlahkan paket per pelaku. `tanpaNama` = jumlah paket yang pelakunya
 * tidak tercatat (data lama sebelum kolom aktor ada) — ditampilkan apa adanya
 * supaya laporan tidak terlihat lebih rapi daripada kenyataan.
 */
export function hitungPerPelaku(
  baris: readonly { id: string | null; nama: string | null }[],
): { daftar: PaketPerPelaku[]; tanpaNama: number } {
  const peta = new Map<string, PaketPerPelaku>();
  let tanpaNama = 0;
  for (const b of baris) {
    if (!b.id) {
      tanpaNama += 1;
      continue;
    }
    const ada = peta.get(b.id);
    if (ada) ada.jumlah += 1;
    else peta.set(b.id, { id: b.id, nama: b.nama ?? '(tanpa nama)', jumlah: 1 });
  }
  const daftar = [...peta.values()].sort((a, b) => b.jumlah - a.jumlah || a.nama.localeCompare(b.nama));
  return { daftar, tanpaNama };
}
