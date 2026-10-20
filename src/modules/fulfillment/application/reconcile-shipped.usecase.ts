import { prisma } from '@/shared/infrastructure/prisma';
import { auditLog } from '@/modules/audit/application/auditLog.service';
import { logger } from '@/shared/observability/logger';
import { consumeStockLotsFifo } from '@/modules/inventory/application/stock-lot.service';
import { resolveParcelPhase, type ParcelPhase } from '../domain/parcel-status';

/**
 * Rekonsiliasi: menutup catatan fulfillment untuk paket yang SUDAH keluar gudang.
 *
 * Kenapa perlu: pesanan bisa dikirim lewat Seller Centre / dijemput kurir tanpa
 * pernah melewati layar packing aplikasi. Sinkronisasi Shopee hanya memperbarui
 * status pesanan dan status kirim; catatan fulfillment tertinggal di
 * `WAITING_STOCK`/`READY_TO_PICK`/… selamanya. Akibatnya scan resi paket yang
 * sudah di jalan berhenti di pemeriksaan stok dan menampilkan "tambah stok".
 *
 * Aturan yang dijaga di sini:
 *  1. Hanya menyentuh paket yang TIDAK lagi di gudang (dijemput / transit /
 *     diterima / gagal / kembali). Paket yang masih menunggu kurir tidak disentuh.
 *  2. Stok dipotong PALING BANYAK SEKALI per pesanan. Kalau barang sudah pernah
 *     dipotong (fulfilledQuantity penuh atau sudah ada ledger untuk pesanan itu),
 *     tidak ada pemotongan kedua.
 *  3. Default `apply: false` (hanya menghitung). Penulisan hanya terjadi kalau
 *     pemanggil meminta `apply: true` — dan setiap penutupan meninggalkan audit log.
 */

export interface ReconcileRow {
  orderId: string;
  externalOrderId: string;
  awb: string | null;
  phase: ParcelPhase;
  phaseLabel: string;
  fulfillmentStatus: string | null;
  targetStatus: 'HANDED_OVER' | 'COMPLETED';
  unitsToDeduct: number;
}

export interface ReconcileSummary {
  diperiksa: number;
  perluDitutup: number;
  ditutup: number;
  unitStokDipotong: number;
  varianStokMinus: number;
  dilewati: number;
  rows: ReconcileRow[];
  messages: string[];
}

/** Status fulfillment yang berarti "paket masih ada di gudang / belum diserahkan". */
const STATUS_MASIH_DI_GUDANG = [
  'WAITING_STOCK',
  'READY_TO_PICK',
  'PICKING',
  'PICKED',
  'PACKING',
  'PACKED',
  'READY_TO_SHIP',
] as const;

export async function reconcileShippedOrders(
  tenantId: string,
  options: { apply?: boolean; actorId: string },
): Promise<ReconcileSummary> {
  const apply = options.apply === true;

  const orders = await prisma.order.findMany({
    where: {
      tenantId,
      status: { notIn: ['CANCELLED'] },
      shipments: { some: { status: { in: ['PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'RETURNED'] } } },
    },
    select: {
      id: true,
      externalOrderId: true,
      status: true,
      items: {
        select: {
          id: true,
          variantId: true,
          quantity: true,
          fulfilledQuantity: true,
          variant: { select: { sku: true } },
        },
      },
      shipments: { orderBy: { createdAt: 'desc' }, take: 1, select: { awb: true, status: true } },
      // SEMUA fulfillment order yang masih terbuka, bukan hanya yang terbaru.
      // Satu pesanan bisa punya lebih dari satu (hasil "Proses ke Fulfillment"
      // berulang); kalau hanya yang terbaru ditutup, yang lama tetap membuat
      // pesanan tampak "masih di gudang" dan terus memicu peringatan.
      fulfillmentOrders: {
        where: { status: { in: [...STATUS_MASIH_DI_GUDANG] } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, status: true, warehouseId: true },
      },
    },
    orderBy: { placedAt: 'desc' },
  });

  const rows: ReconcileRow[] = [];
  const messages: string[] = [];
  let ditutup = 0;
  let unitStokDipotong = 0;
  let varianStokMinus = 0;
  let dilewati = 0;

  for (const order of orders) {
    const terbuka = order.fulfillmentOrders;
    if (terbuka.length === 0) {
      // Tidak ada catatan fulfillment yang tertinggal → bukan urusan rekonsiliasi.
      dilewati += 1;
      continue;
    }

    const shipment = order.shipments[0];
    const phase = resolveParcelPhase(shipment?.status);
    const targetStatus = phase === 'DITERIMA' ? 'COMPLETED' : 'HANDED_OVER';
    const unitsToDeduct = order.items.reduce((sum, i) => sum + Math.max(0, i.quantity - i.fulfilledQuantity), 0);

    rows.push({
      orderId: order.id,
      externalOrderId: order.externalOrderId,
      awb: shipment?.awb ?? null,
      phase,
      phaseLabel: phase,
      fulfillmentStatus: terbuka.map((f) => f.status).join(', '),
      targetStatus,
      unitsToDeduct,
    });

    if (!apply) continue;

    let adaYangDitutup = false;
    for (const fo of terbuka) {
      const hasil = await tutupSatuPesanan({
        tenantId,
        actorId: options.actorId,
        order,
        fulfillmentOrderId: fo.id,
        warehouseId: fo.warehouseId,
        statusLama: fo.status,
        targetStatus,
      });
      if (!hasil) continue;
      adaYangDitutup = true;
      unitStokDipotong += hasil.units;
      if (hasil.negatif) varianStokMinus += 1;
    }

    if (adaYangDitutup) ditutup += 1;
    else dilewati += 1;
  }

  if (apply && ditutup > 0) {
    messages.push(
      `${ditutup} pesanan ditutup otomatis karena paketnya sudah keluar gudang, ` +
        `${unitStokDipotong} unit stok dipotong susulan` +
        (varianStokMinus > 0 ? ` (${varianStokMinus} varian menjadi minus — isi saldo awal agar akurat).` : '.'),
    );
    logger.info('Rekonsiliasi paket sudah dikirim', {
      tenantId,
      ditutup,
      unitStokDipotong,
      varianStokMinus,
    });
  }
  if (!apply && rows.length > 0) {
    messages.push(
      `${rows.length} pesanan perlu ditutup karena paketnya sudah keluar gudang. ` +
        `Belum ada yang diubah — tekan "Tutup otomatis" untuk menerapkan.`,
    );
  }

  return {
    diperiksa: orders.length,
    perluDitutup: rows.length,
    ditutup,
    unitStokDipotong,
    varianStokMinus,
    dilewati,
    rows: rows.slice(0, 50),
    messages,
  };
}

interface TutupArgumen {
  tenantId: string;
  actorId: string;
  order: {
    id: string;
    externalOrderId: string;
    items: Array<{
      id: string;
      variantId: string;
      quantity: number;
      fulfilledQuantity: number;
      variant: { sku: string };
    }>;
  };
  fulfillmentOrderId: string;
  warehouseId: string;
  statusLama: string;
  targetStatus: 'HANDED_OVER' | 'COMPLETED';
}

/** Tutup satu pesanan; mengembalikan null kalau ternyata sudah ditutup pihak lain. */
async function tutupSatuPesanan(
  arg: TutupArgumen,
): Promise<{ units: number; negatif: boolean } | null> {
  return prisma.$transaction(async (tx) => {
    // Kunci-lahan: hanya satu proses yang boleh menutup status ini.
    const klaim = await tx.fulfillmentOrder.updateMany({
      where: { id: arg.fulfillmentOrderId, status: arg.statusLama as never },
      data: { status: arg.targetStatus },
    });
    if (klaim.count === 0) return null;

    let units = 0;
    let negatif = false;

    for (const item of arg.order.items) {
      const sisa = item.quantity - item.fulfilledQuantity;
      if (sisa <= 0) continue; // stok untuk baris ini sudah pernah dipotong

      const saldo = await tx.inventoryBalance.upsert({
        where: { warehouseId_variantId: { warehouseId: arg.warehouseId, variantId: item.variantId } },
        update: { onHand: { decrement: sisa }, version: { increment: 1 } },
        create: { warehouseId: arg.warehouseId, variantId: item.variantId, onHand: -sisa },
      });
      if (saldo.onHand < 0) negatif = true;

      const lots = await consumeStockLotsFifo(tx, {
        warehouseId: arg.warehouseId,
        variantId: item.variantId,
        quantity: sisa,
        referenceId: arg.order.id,
      });

      await tx.inventoryMovement.create({
        data: {
          tenantId: arg.tenantId,
          warehouseId: arg.warehouseId,
          variantId: item.variantId,
          movementType: 'DEDUCTION',
          quantityDelta: -sisa,
          referenceType: 'order',
          referenceId: arg.order.id,
          stockLotId: lots[0]?.lotId ?? null,
          reason: 'Pesanan sudah dikirim sebelum dipacking — stok dipotong saat rekonsiliasi',
          actorId: arg.actorId,
        },
      });

      // Reservasi yang masih aktif tidak boleh menggantung setelah barang keluar.
      const reservasi = await tx.stockReservation.findMany({
        where: { orderItemId: item.id, status: 'ACTIVE' },
        select: { id: true, quantity: true },
      });
      for (const res of reservasi) {
        await tx.inventoryBalance.update({
          where: { warehouseId_variantId: { warehouseId: arg.warehouseId, variantId: item.variantId } },
          data: { reserved: { decrement: res.quantity }, version: { increment: 1 } },
        });
        await tx.stockReservation.update({ where: { id: res.id }, data: { status: 'CONSUMED' } });
      }

      await tx.orderItem.update({
        where: { id: item.id },
        data: { fulfilledQuantity: item.quantity, status: 'FULFILLED' },
      });

      units += sisa;
    }

    await auditLog({
      tenantId: arg.tenantId,
      actorId: arg.actorId,
      action: 'reconcile_shipped_closed',
      entityType: 'FulfillmentOrder',
      entityId: arg.fulfillmentOrderId,
      metadata: {
        orderId: arg.order.id,
        externalOrderId: arg.order.externalOrderId,
        from: arg.statusLama,
        to: arg.targetStatus,
        unitsDeducted: units,
        reason: 'Paket sudah keluar gudang (dijemput/transit/diterima)',
      },
    });

    return { units, negatif };
  });
}
