import { prisma } from '@/shared/infrastructure/prisma';
import { resolveRangePreset, type DateRange, type RangePreset } from '@/modules/fulfillment/domain/date-range';
import {
  hitungPerPelaku,
  hitungTahap,
  type HitunganTahap,
  type PaketPerPelaku,
} from '../domain/operation-metrics';

export interface OperasionalRingkas {
  preset: RangePreset;
  rentang: { from: string | null; to: string | null };
  /** Keadaan SEKARANG: pekerjaan yang masih menunggu di gudang. */
  tahap: HitunganTahap;
  /** Aksi di aplikasi DALAM RENTANG tanggal (dikerjakan lewat layar ini). */
  kejadian: {
    dipacking: number;
    diserahkan: number;
  };
  /**
   * Kejadian dari Shopee DALAM RENTANG: paket yang benar-benar dijemput kurir.
   * Dihitung dari tanggal kejadian yang stabil (`shippedAt`, cadangan
   * `deliveredAt`) — BUKAN `updatedAt`, yang ikut berubah setiap kali
   * sinkronisasi menyentuh barisnya sehingga angka kartu naik sendiri.
   */
  kejadianShopee: {
    dijemputKurir: number;
  };
  packing: { daftar: PaketPerPelaku[]; tanpaNama: number };
  serahTerima: { daftar: PaketPerPelaku[]; tanpaNama: number };
}

/**
 * Ringkasan operasional untuk owner.
 *
 * Tiga jenis angka, sengaja dipisah supaya tidak menyesatkan:
 *  1. `tahap` — keadaan hari ini (berapa paket masih menunggu di tiap tahap).
 *     Tidak disaring tanggal, karena "masih menunggu" memang keadaan sekarang.
 *  2. `kejadian` + per-pelaku — AKSI DI APLIKASI, disaring tanggal kejadian
 *     (kapan dipacking, kapan diserahkan), dasar pembayaran per paket.
 *  3. `kejadianShopee` — kejadian di sisi Shopee (paket dijemput kurir), juga
 *     disaring tanggal kejadiannya. Terpisah dari (2) karena pelakunya bukan
 *     operator aplikasi: paket bisa dikirim lewat Seller Centre tanpa pernah
 *     melewati layar packing.
 */
export async function getOperasionalRingkas(
  tenantId: string,
  preset: RangePreset,
  now: Date = new Date(),
): Promise<OperasionalRingkas> {
  const range: DateRange = resolveRangePreset(preset, now);
  const filterTanggal = {
    ...(range.from ? { gte: range.from } : {}),
    ...(range.to ? { lt: range.to } : {}),
  };

  const [pekerjaan, dipacking, diserahkan, dijemputKurir] = await Promise.all([
    prisma.fulfillmentOrder.findMany({
      where: { order: { tenantId }, status: { notIn: ['COMPLETED'] } },
      select: { status: true },
    }),
    prisma.fulfillmentOrder.findMany({
      where: { order: { tenantId }, packedAt: filterTanggal },
      select: { packedById: true },
    }),
    prisma.fulfillmentOrder.findMany({
      where: { order: { tenantId }, handedOverAt: filterTanggal },
      select: { handedOverById: true },
    }),
    // "Dijemput kurir Shopee" = paket sudah keluar gudang menurut kurir.
    // Tanggal kejadiannya `shippedAt` (di-set sekali saat paket meninggalkan
    // gudang); untuk data lama yang shippedAt-nya kosong tapi sudah DELIVERED,
    // `deliveredAt` menjadi cadangan.
    prisma.shipment.count({
      where: {
        order: { tenantId },
        status: { in: ['PICKED_UP', 'IN_TRANSIT', 'DELIVERED'] },
        OR: [
          { shippedAt: filterTanggal },
          { shippedAt: null, deliveredAt: filterTanggal },
        ],
      },
    }),
  ]);

  // Nama pelaku diambil sekali (bukan per baris).
  const idPelaku = [
    ...new Set(
      [
        ...dipacking.map((d) => d.packedById),
        ...diserahkan.map((d) => d.handedOverById),
      ].filter(Boolean) as string[],
    ),
  ];
  const nama = new Map<string, string>();
  if (idPelaku.length > 0) {
    const pengguna = await prisma.user.findMany({
      where: { id: { in: idPelaku } },
      select: { id: true, name: true },
    });
    for (const u of pengguna) nama.set(u.id, u.name);
  }

  return {
    preset,
    rentang: {
      from: range.from ? range.from.toISOString() : null,
      to: range.to ? range.to.toISOString() : null,
    },
    tahap: hitungTahap(pekerjaan.map((p) => p.status)),
    kejadian: {
      dipacking: dipacking.length,
      diserahkan: diserahkan.length,
    },
    kejadianShopee: {
      dijemputKurir,
    },
    packing: hitungPerPelaku(
      dipacking.map((d) => ({ id: d.packedById, nama: d.packedById ? nama.get(d.packedById) ?? null : null })),
    ),
    serahTerima: hitungPerPelaku(
      diserahkan.map((d) => ({
        id: d.handedOverById,
        nama: d.handedOverById ? nama.get(d.handedOverById) ?? null : null,
      })),
    ),
  };
}
