import { prisma } from '@/shared/infrastructure/prisma';
import { awalHari, buatKodeBatch, kunciCetak } from '../domain/production-batch';

export interface HasilCatatCetak {
  /** true = cetakan identik sudah tercatat hari ini (peringatan, bukan baris baru). */
  duplikat: boolean;
  kodeBatch: string | null;
  dicetakPada: Date | null;
  totalOrders: number;
  totalUnits: number;
}

/**
 * Catat satu cetakan lembar produksi.
 *
 * - Hari yang sama + isi (himpunan pesanan) yang sama → `duplikat: true`,
 *   tidak membuat baris baru. Ini penjaga "cetak dua kali ≠ produksi dua kali".
 * - Isi berbeda / hari berbeda → batch baru dengan kode `PROD-YYYYMMDD-N`.
 */
export async function catatPencetakan(input: {
  tenantId: string;
  actorId: string | null;
  /** himpunan pesanan yang BENAR-BENAR tercetak (dari daftar yang dikirim ke PDF). */
  orderIds: string[];
  totalOrders: number;
  totalUnits: number;
  sekarang?: Date;
}): Promise<HasilCatatCetak> {
  const sekarang = input.sekarang ?? new Date();
  const identitas = kunciCetak(input.orderIds);

  const batchHariIni = await prisma.productionBatch.findMany({
    where: { tenantId: input.tenantId, printedAt: { gte: awalHari(sekarang) } },
    orderBy: { printedAt: 'desc' },
    take: 20,
  });

  const sama = batchHariIni.find((b) => Array.isArray(b.orderIds) && kunciCetak(b.orderIds as string[]) === identitas);
  if (sama) {
    return {
      duplikat: true,
      kodeBatch: sama.kodeBatch,
      dicetakPada: sama.printedAt,
      totalOrders: sama.totalOrders,
      totalUnits: sama.totalUnits,
    };
  }

  const kodeBatch = buatKodeBatch(sekarang, batchHariIni.length + 1);
  await prisma.productionBatch.create({
    data: {
      tenantId: input.tenantId,
      kodeBatch,
      printedAt: sekarang,
      printedBy: input.actorId,
      totalOrders: input.totalOrders,
      totalUnits: input.totalUnits,
      orderIds: input.orderIds,
    },
  });

  return {
    duplikat: false,
    kodeBatch,
    dicetakPada: sekarang,
    totalOrders: input.totalOrders,
    totalUnits: input.totalUnits,
  };
}

export async function ambilCetakanTerakhir(tenantId: string) {
  const terakhir = await prisma.productionBatch.findFirst({
    where: { tenantId },
    orderBy: { printedAt: 'desc' },
    select: { kodeBatch: true, printedAt: true, totalOrders: true, totalUnits: true },
  });
  return terakhir;
}
