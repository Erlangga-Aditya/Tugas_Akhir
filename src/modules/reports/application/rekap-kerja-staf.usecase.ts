/**
 * Use case: rekap kerja staf per minggu gaji.
 *
 * Membaca jejak aksi yang sudah tercatat di FulfillmentOrder:
 *  - packing   → kolom `packedById`   + `packedAt`
 *  - serah kirim → kolom `handedOverById` + `handedOverAt`
 *
 * Sifat laporan ini: **read-only**. Tidak ada transaksi, tidak ada
 * perubahan stok, tidak ada side-effect. Aman dipanggil berulangkali
 * (idempoten) — setiap panggilan membaca keadaan terkini.
 *
 * Optimasi: dalam satu minggu maksimal 31 hari, dan batas atas
 * rentang selalu jatuh pada awal bulan berikutnya. Karena itu dipakai
 * query rentang `packedAt: { gte, lt }` tunggal per jenis kerjaan,
 * lalu pengelompokan per pelaku & per hari dilakukan di memori —
 * satu round-trip per jenis kerjaan, tidak ada N+1.
 *
 * Anti-IDOR: `tenantId` selalu diambil dari AuthContext, tidak pernah
 * dari query pemanggil.
 */

import { prisma } from '@/shared/infrastructure/prisma';
import { logger } from '@/shared/observability/logger';
import type { NomorMingguGaji, RentangMingguGaji } from '../domain/minggu-gaji';
import { selesaikanMingguGaji } from '../domain/minggu-gaji';

/** Jenis kerjaan yang dilaporkan. */
export type JenisKerjaan = 'packing' | 'serahKirim';

export const JENIS_KERJAAN: readonly JenisKerjaan[] = ['packing', 'serahKirim'] as const;

export const LABEL_JENIS_KERJAAN: Record<JenisKerjaan, string> = {
  packing: 'Packing',
  serahKirim: 'Kirim',
};

/** Satu baris rekap harian seorang staf pada satu jenis kerjaan. */
export interface RekapHarian {
  /** ID user (akun) yang melakukan aksi. */
  userId: string;
  /** Nama staf untuk tampilan. */
  nama: string;
  /** Tanggal (UTC ISO) — selalu 00:00 WIB hari itu. */
  tanggalISO: string;
  /** Nomor hari dalam bulan (1–31) — untuk kolom tabel. */
  tanggal: number;
  /** Jenis kerjaan. */
  jenis: JenisKerjaan;
  /** Jumlah paket yang dikerjakan staf ini pada hari itu. */
  jumlah: number;
}

/** Satu pesanan dalam rincian harian seorang staf. */
export interface RincianPesanan {
  /** Nomor pesanan dari marketplace (external order id). */
  orderCode: string | null;
  /** Jam aksi dalam format HH.MM WIB. */
  jam: string;
}

/** Rekap satu jenis kerjaan untuk seluruh staf dalam rentang minggu. */
export interface RekapPerJenis {
  jenis: JenisKerjaan;
  label: string;
  daftar: Array<{
    userId: string;
    nama: string;
    /** Total paket minggu ini. */
    total: number;
    /** Rincian harian: tanggal → jumlah + daftar pesanan. */
    perHari: Array<{
      tanggal: number;
      jumlah: number;
      /** Rincian pesanan untuk verifikasi sebelum gaji. */
      rincian: RincianPesanan[];
    }>;
  }>;
}

/** Ringkasan total per orang — yang dilihat owner saat menggaji. */
export interface RingkasanPerOrang {
  userId: string;
  nama: string;
  totalPacking: number;
  totalSerahKirim: number;
  /** Gabungan kedua jenis kerjaan. */
  totalSemua: number;
}

export interface RekapKerjaStaf {
  rentang: {
    dari: string;
    sampai: string;
    minggu: NomorMingguGaji;
    bulan: number;
    tahun: number;
    /** Label siap tampil, contoh: "8 – 14 Oktober 2026". */
    label: string;
  };
  /** Nama hari dalam seminggu untuk header tabel, Senin–Minggu. */
  namaHari: string[];
  /** Tanggal akhir tiap kolom hari, sejajar dengan `namaHari`. */
  kolomHari: number[];
  packing: RekapPerJenis;
  serahKirim: RekapPerJenis;
  ringkasan: RingkasanPerOrang[];
}

const NAMA_BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
] as const;

/** Ambil tanggal (1–31) dari sebuah instant, dalam WIB. */
function tanggalWib(instant: Date): number {
  return new Date(instant.getTime() + 7 * 60 * 60 * 1000).getUTCDate();
}

/** Bangun label rentang, contoh: "8 – 14 Oktober 2026". */
function labelRentang(r: RentangMingguGaji): string {
  if (r.tanggalAwal === r.tanggalAkhir) {
    return `${r.tanggalAwal} ${NAMA_BULAN[r.bulan - 1]} ${r.tahun}`;
  }
  return `${r.tanggalAwal} – ${r.tanggalAkhir} ${NAMA_BULAN[r.bulan - 1]} ${r.tahun}`;
}

/** Bangun nama hari (Senin–Minggu) + tanggal kolom tabel. */
function kolomTabel(r: RentangMingguGaji): { namaHari: string[]; kolomHari: number[] } {
  const NAMA_HARI = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
  // Hari pertama potongan minggu selalu tanggal 1, 8, 15, atau 22.
  // Cari hari dalam seminggu dari tanggal awal.
  const awal = new Date(Date.UTC(r.tahun, r.bulan - 1, r.tanggalAwal));
  const indexHariAwal = (awal.getUTCDay() + 6) % 7; // 0 = Senin
  const jumlahHari = r.tanggalAkhir - r.tanggalAwal + 1;

  const namaHari: string[] = [];
  const kolomHari: number[] = [];
  for (let i = 0; i < jumlahHari; i++) {
    namaHari.push(NAMA_HARI[(indexHariAwal + i) % 7] as string);
    kolomHari.push(r.tanggalAwal + i);
  }
  return { namaHari, kolomHari };
}

/** Query fulfillment order yang sudah selesai dalam rentang, beserta pelakunya. */
async function ambilJejakAksi(
  tenantId: string,
  rentang: RentangMingguGaji,
  jenis: JenisKerjaan,
): Promise<Array<{ actorId: string | null; at: Date; orderCode: string | null }>> {
  const baris = await prisma.fulfillmentOrder.findMany({
    where: {
      order: { tenantId },
      ...(jenis === 'packing'
        ? { packedAt: { gte: rentang.from, lt: rentang.to } }
        : { handedOverAt: { gte: rentang.from, lt: rentang.to } }),
    },
    select: {
      packedById: true,
      packedAt: true,
      handedOverById: true,
      handedOverAt: true,
      order: { select: { externalOrderId: true } },
    },
  });

  return baris.map((b) => ({
    actorId: jenis === 'packing' ? b.packedById : b.handedOverById,
    at: (jenis === 'packing' ? b.packedAt : b.handedOverAt) as Date,
    orderCode: b.order.externalOrderId,
  }));
}

/** Format jam WIB dari sebuah instant, contoh "10.30". */
function formatJamWib(instant: Date): string {
  const wib = new Date(instant.getTime() + 7 * 60 * 60 * 1000);
  const hh = String(wib.getUTCHours()).padStart(2, '0');
  const mm = String(wib.getUTCMinutes()).padStart(2, '0');
  return `${hh}.${mm}`;
}

/** Kelompokkan jejak aksi menjadi rekap per pelaku + per hari + rincian pesanan. */
function ringkaskanJejak(
  jejak: Array<{ actorId: string | null; at: Date; orderCode: string | null }>,
  petaNama: Map<string, string>,
): RekapPerJenis['daftar'] {
  // userId → tanggal(1–31) → daftar pesanan
  const perStaf = new Map<string, Map<number, RincianPesanan[]>>();

  for (const j of jejak) {
    if (!j.actorId) continue; // tanpa pelaku → tidak masuk rekap (data lama)
    const perHari = perStaf.get(j.actorId) ?? new Map<number, RincianPesanan[]>();
    const tgl = tanggalWib(j.at);
    const daftar = perHari.get(tgl) ?? [];
    daftar.push({ orderCode: j.orderCode, jam: formatJamWib(j.at) });
    perHari.set(tgl, daftar);
    perStaf.set(j.actorId, perHari);
  }

  const daftar = [...perStaf.entries()].map(([userId, perHari]) => {
    let total = 0;
    const perHariList = [...perHari.entries()]
      .map(([tanggal, rincian]) => {
        total += rincian.length;
        // Urut jan termuda → tertua; nomor pesanan sebagai tiebreaker.
        const rincianTerurut = [...rincian].sort(
          (a, b) => a.jam.localeCompare(b.jam) || String(a.orderCode).localeCompare(String(b.orderCode)),
        );
        return { tanggal, jumlah: rincian.length, rincian: rincianTerurut };
      })
      .sort((a, b) => a.tanggal - b.tanggal);
    return {
      userId,
      nama: petaNama.get(userId) ?? '(tanpa nama)',
      total,
      perHari: perHariList,
    };
  });

  // Urut: total terbanyak dulu, kedua berdasarkan nama.
  return daftar.sort((a, b) => b.total - a.total || a.nama.localeCompare(b.nama));
}

/**
 * Ambil rentang tahun yang memiliki catatan kerja staf — dipakai dropdown
 * filter tahun di UI. Tahun tanpa catatan apa pun tidak perlu ditampilkan.
 *
 * Selalu menyertakan tahun berjalan: owner wajib bisa membuka tahun ini
 * walau belum ada aksi (mis. 1 Januari tahun baru).
 */
export async function getTahunTersedia(tenantId: string): Promise<{ min: number; max: number }> {
  const tahunIni = new Date().getFullYear();
  const hasil = await prisma.fulfillmentOrder.aggregate({
    where: { order: { tenantId } },
    _min: { packedAt: true, handedOverAt: true },
    _max: { packedAt: true, handedOverAt: true },
  });
  const kandidatMin = [hasil._min.packedAt, hasil._min.handedOverAt].filter(
    (v): v is Date => v !== null,
  );
  const kandidatMax = [hasil._max.packedAt, hasil._max.handedOverAt].filter(
    (v): v is Date => v !== null,
  );
  const minData = kandidatMin.length > 0 ? Math.min(...kandidatMin.map((d) => d.getUTCFullYear())) : tahunIni;
  const maxData = kandidatMax.length > 0 ? Math.max(...kandidatMax.map((d) => d.getUTCFullYear())) : tahunIni;
  return { min: Math.min(minData, tahunIni), max: Math.max(maxData, tahunIni) };
}

/**
 * Ambil rekap kerja staf untuk satu minggu gaji.
 *
 * @param tenantId Dari AuthContext (anti-IDOR).
 * @param tahun Tahun, mis. 2026.
 * @param bulan Bulan 1–12.
 * @param minggu Nomor minggu 1–4.
 */
export async function getRekapKerjaStaf(
  tenantId: string,
  tahun: number,
  bulan: number,
  minggu: NomorMingguGaji,
): Promise<RekapKerjaStaf> {
  // Validasi input — bulan harus 1–12. Tahun dibatasi wajar (tidak hardcoded
  // ke 2026; sewaktu-waktu bisa melihat tahun lalu untuk audit gaji).
  if (bulan < 1 || bulan > 12) {
    throw new Error(`Bulan tidak valid: ${bulan}`);
  }
  if (tahun < 2000 || tahun > 2100) {
    throw new Error(`Tahun tidak valid: ${tahun}`);
  }

  const rentang = selesaikanMingguGaji(tahun, bulan, minggu);
  const { namaHari, kolomHari } = kolomTabel(rentang);

  // Ambil jejak kedua jenis kerjaan secara paralel — satu round-trip efektif.
  const [jejakPacking, jejakSerah] = await Promise.all([
    ambilJejakAksi(tenantId, rentang, 'packing'),
    ambilJejakAksi(tenantId, rentang, 'serahKirim'),
  ]);

  // Ambil nama semua pelaku sekali (bukan per baris — anti N+1).
  const idPelaku = [...new Set(
    [...jejakPacking, ...jejakSerah]
      .map((j) => j.actorId)
      .filter((id): id is string => id !== null),
  )];
  const petaNama = new Map<string, string>();
  if (idPelaku.length > 0) {
    const pengguna = await prisma.user.findMany({
      where: { id: { in: idPelaku } },
      select: { id: true, name: true },
    });
    for (const u of pengguna) petaNama.set(u.id, u.name);
  }

  const daftarPacking = ringkaskanJejak(jejakPacking, petaNama);
  const daftarSerah = ringkaskanJejak(jejakSerah, petaNama);

  // Ringkasan per orang — gabungan kedua jenis kerjaan.
  const ringkasanMap = new Map<string, RingkasanPerOrang>();
  for (const d of daftarPacking) {
    const r = ringkasanMap.get(d.userId) ?? {
      userId: d.userId,
      nama: d.nama,
      totalPacking: 0,
      totalSerahKirim: 0,
      totalSemua: 0,
    };
    r.totalPacking += d.total;
    ringkasanMap.set(d.userId, r);
  }
  for (const d of daftarSerah) {
    const r = ringkasanMap.get(d.userId) ?? {
      userId: d.userId,
      nama: d.nama,
      totalPacking: 0,
      totalSerahKirim: 0,
      totalSemua: 0,
    };
    r.totalSerahKirim += d.total;
    ringkasanMap.set(d.userId, r);
  }
  const ringkasan = [...ringkasanMap.values()]
    .map((r) => ({ ...r, totalSemua: r.totalPacking + r.totalSerahKirim }))
    .sort((a, b) => b.totalSemua - a.totalSemua || a.nama.localeCompare(b.nama));

  logger.info('Rekap kerja staf dibuat', {
    tenantId,
    minggu,
    bulan,
    tahun,
    jumlahPacking: daftarPacking.reduce((s, d) => s + d.total, 0),
    jumlahSerah: daftarSerah.reduce((s, d) => s + d.total, 0),
  });

  return {
    rentang: {
      dari: rentang.from.toISOString(),
      sampai: rentang.to.toISOString(),
      minggu: rentang.minggu,
      bulan: rentang.bulan,
      tahun: rentang.tahun,
      label: labelRentang(rentang),
    },
    namaHari,
    kolomHari,
    packing: { jenis: 'packing', label: LABEL_JENIS_KERJAAN.packing, daftar: daftarPacking },
    serahKirim: { jenis: 'serahKirim', label: LABEL_JENIS_KERJAAN.serahKirim, daftar: daftarSerah },
    ringkasan,
  };
}
