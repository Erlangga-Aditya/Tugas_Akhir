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
  /** Kejadian DALAM RENTANG tanggal. */
  kejadian: {
    dipacking: number;
    diserahkan: number;
    diterimaKurirShopee: number;
  };
  packing: { daftar: PaketPerPelaku[]; tanpaNama: number };
  serahTerima: { daftar: PaketPerPelaku[]; tanpaNama: number };
}

/**
 * Ringkasan operasional untuk owner.
 *
 * Dua jenis angka, sengaja dipisah supaya tidak menyesatkan:
 *  1. `tahap` — keadaan hari ini (berapa paket masih menunggu di tiap tahap).
 *     Tidak disaring tanggal, karena "masih menunggu" memang keadaan sekarang.
 *  2. `kejadian` + per-pelaku — disaring tanggal kejadian (kapan dipacking,
 *     kapan diserahkan), karena inilah dasar pembayaran per paket.
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

  const [pekerjaan, dipacking, diserahkan, diterimaKurirShopee] = await Promise.all([
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
    prisma.shipment.count({
      where: {
        order: { tenantId },
        status: { in: ['PICKED_UP', 'IN_TRANSIT', 'DELIVERED'] },
        updatedAt: filterTanggal,
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
      diterimaKurirShopee,
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
