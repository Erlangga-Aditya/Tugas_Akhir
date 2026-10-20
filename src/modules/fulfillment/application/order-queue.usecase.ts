import { prisma } from '@/shared/infrastructure/prisma';
import { createTtlCache } from '@/shared/infrastructure/ttlCache';
import { placedAtFilter, type DateRange } from '../domain/date-range';
import { classifyWorkQueue, countBuckets, type QueueCounts } from '../domain/work-queue';

/**
 * Hitungan antrean kerja gudang — SATU sumber untuk badge menu dan kartu
 * ringkasan halaman Pesanan.
 *
 * Query-nya sengaja memilih kolom sesedikit mungkin (tanpa item, tanpa varian,
 * tanpa alokasi stok) karena hanya butuh tiga angka. Hasilnya di-cache 15 detik
 * per (tenant + rentang tanggal) supaya permintaan tiap 30 detik tidak
 * menembak database terus-menerus.
 */

export const ORDER_QUEUE_TTL_MS = 15_000;

const queueCountCache = createTtlCache<QueueCounts>({ ttlMs: ORDER_QUEUE_TTL_MS, maxEntries: 120 });

function cacheKey(tenantId: string, range: DateRange): string {
  const from = range.from ? range.from.toISOString() : '-';
  const to = range.to ? range.to.toISOString() : '-';
  return `${tenantId}|${from}|${to}`;
}

/** Buang cache satu tenant (dipakai setelah aksi yang mengubah antrean). */
export function invalidateOrderQueue(tenantId: string): void {
  queueCountCache.invalidatePrefix(`${tenantId}|`);
}

export async function countOrderQueue(tenantId: string, range: DateRange): Promise<QueueCounts> {
  const key = cacheKey(tenantId, range);
  const cached = queueCountCache.get(key);
  if (cached) return cached;

  const placedAt = placedAtFilter(range);
  const rows = await prisma.order.findMany({
    where: {
      tenantId,
      // Batal & selesai tidak pernah masuk antrean kerja; menyaring di sini
      // membuat query jauh lebih ringan pada data historis yang besar.
      status: { in: ['NEW', 'CONFIRMED'] },
      ...(placedAt ? { placedAt } : {}),
    },
    select: {
      status: true,
      // Status mentah Shopee: dasar pembeda "Belum diproses" vs "Telah diproses".
      externalStatus: true,
      fulfillmentOrders: {
        where: { status: { notIn: ['COMPLETED'] } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { status: true },
      },
      shipments: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { awb: true, status: true },
      },
    },
  });

  const entries = rows.map((row) => {
    const fo = row.fulfillmentOrders[0] ?? null;
    const shipment = row.shipments[0] ?? null;
    return classifyWorkQueue({
      orderStatus: row.status,
      externalStatus: row.externalStatus,
      fulfillmentStatus: fo?.status ?? null,
      shipmentStatus: shipment?.status ?? null,
      hasAwb: Boolean(shipment?.awb?.trim()),
    });
  });

  const counts = countBuckets(entries);
  queueCountCache.set(key, counts);
  return counts;
}
