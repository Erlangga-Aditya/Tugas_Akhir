import { prisma } from '@/shared/infrastructure/prisma';
import {
  completePacking,
  prepareFulfillmentForPacking,
  getOrderShortfalls,
  type PendingPickingItem,
  type StockShortfall,
} from './fulfillment.usecase';
import { logger } from '@/shared/observability/logger';

/**
 * Scan Resi / AWB — orkestrasi packing yang JUJUR.
 *
 * Aturan emas modul ini: `stockDeducted` hanya `true` kalau stok benar-benar sudah
 * dikurangi di database pada pemanggilan itu. Tidak ada klaim "berhasil" yang tidak
 * bisa dibuktikan oleh baris ledger `inventory_movements`.
 */

export type AwbScanCode =
  | 'PACKED'
  | 'ALREADY_PACKED'
  | 'ALREADY_HANDED_OVER'
  | 'NEEDS_PICKING'
  | 'WAITING_STOCK'
  | 'NOT_QUEUED'
  | 'NEEDS_SHIPMENT'
  | 'EXCEPTION'
  | 'NOT_FOUND';

/** Aksi lanjutan yang HARUS dipilih operator (tidak pernah dilakukan otomatis). */
export type AwbScanConfirmation = 'PICKING' | 'NEGATIVE_STOCK' | null;

export interface AwbScanOrderItem {
  id: string;
  sku: string;
  variantName: string;
  productName: string;
  quantity: number;
  available: number;
  stockDeducted: boolean;
}

export interface AwbScanOrderSummary {
  id: string;
  externalOrderId: string;
  buyerName: string | null;
  shopName: string;
  provider: string;
  orderStatus: string;
  fulfillmentStatus: string | null;
  awb: string | null;
  carrier: string | null;
  /** Label resmi hanya bisa dicetak kalau nomor resi dari Shopee sudah ada. */
  canPrintOfficialLabel: boolean;
  items: AwbScanOrderItem[];
}

export interface AwbScanOutcome {
  code: AwbScanCode;
  /** Pesan siap tampil ke operator — selalu menggambarkan keadaan sebenarnya. */
  message: string;
  stockDeducted: boolean;
  deductedUnits: number;
  /** Kalau tidak null, UI harus menampilkan tombol konfirmasi eksplisit. */
  needsConfirmation: AwbScanConfirmation;
  pendingPicking: PendingPickingItem[];
  shortfalls: StockShortfall[];
  order: AwbScanOrderSummary | null;
}

function emptyOutcome(
  code: AwbScanCode,
  message: string,
  extra: Partial<AwbScanOutcome> = {},
): AwbScanOutcome {
  return {
    code,
    message,
    stockDeducted: false,
    deductedUnits: 0,
    needsConfirmation: null,
    pendingPicking: [],
    shortfalls: [],
    order: null,
    ...extra,
  };
}

/**
 * Bangun ringkasan pesanan (produk, resi, label) untuk ditampilkan di UI.
 * Dipakai baik saat sukses maupun gagal, supaya operator selalu melihat konteks pesanan.
 */
async function buildOrderSummary(orderId: string): Promise<AwbScanOrderSummary | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      shop: { select: { name: true, provider: true } },
      items: {
        include: {
          variant: { include: { product: { select: { name: true } } } },
          reservations: { where: { status: 'ACTIVE' }, select: { quantity: true } },
        },
      },
      shipments: { orderBy: { createdAt: 'desc' }, take: 1 },
      fulfillmentOrders: {
        where: { status: { notIn: ['COMPLETED'] } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true, status: true, warehouseId: true },
      },
    },
  });
  if (!order) return null;

  const fo = order.fulfillmentOrders[0] ?? null;
  const shortfalls = fo
    ? await getOrderShortfalls(order.tenantId, fo.warehouseId, order.items)
    : [];
  const shortfallByVariant = new Map(shortfalls.map((s) => [s.variantId, s]));
  const shipment = order.shipments[0] ?? null;

  return {
    id: order.id,
    externalOrderId: order.externalOrderId,
    buyerName: order.buyerName,
    shopName: order.shop.name,
    provider: order.shop.provider,
    orderStatus: order.status,
    fulfillmentStatus: fo?.status ?? null,
    awb: shipment?.awb ?? null,
    carrier: shipment?.carrier ?? null,
    canPrintOfficialLabel: Boolean(shipment?.awb?.trim()),
    items: order.items.map((i) => ({
      id: i.id,
      sku: i.variant.sku,
      variantName: i.variant.name,
      productName: i.variant.product.name,
      quantity: i.quantity,
      available: shortfallByVariant.get(i.variantId)?.available ?? i.quantity,
      stockDeducted: i.fulfilledQuantity >= i.quantity,
    })),
  };
}

/**
 * Cari pesanan dari AWB lebih dulu (itu satu-satunya gerbang packing).
 * Nomor pesanan hanya lookup konteks supaya operator melihat pesanan yang salah;
 * nanti `scanAwbForPacking` tetap menolak karena `shipment.awb !== code`.
 * Penting: kedua query harus di-`await` satu per satu — memakai `??` pada
 * hasil `Promise` membuat cabang kedua tidak pernah dieksekusi.
 */
async function findOrderByCode(tenantId: string, code: string) {
  const byAwb = await prisma.order.findFirst({
    where: { tenantId, shipments: { some: { awb: code } } },
    select: { id: true },
  });
  if (byAwb) return byAwb;
  return prisma.order.findFirst({
    where: { tenantId, OR: [{ externalOrderId: code }, { id: code }] },
    select: { id: true },
  });
}

/**
 * Proses hasil scan resi.
 *
 * @param confirmPicking  true = operator memilih "packing cepat" (picking dikonfirmasi tanpa
 *                        scan per item, tercatat di audit log). false = sistem menuntut picking selesai.
 * @param allowNegativeStock true = operator memilih tetap packing walau stok kurang (stok jadi minus).
 */
export async function scanAwbForPacking(
  tenantId: string,
  rawCode: string,
  actorId: string,
  options: { confirmPicking?: boolean; allowNegativeStock?: boolean } = {},
): Promise<AwbScanOutcome> {
  const code = rawCode.trim();
  if (!code) return emptyOutcome('NOT_FOUND', 'Kode resi kosong.');

  const found = await findOrderByCode(tenantId, code);
  if (!found) {
    return emptyOutcome(
      'NOT_FOUND',
      `Kode "${code}" tidak ditemukan sebagai nomor resi pada toko yang terhubung. Pastikan barcode yang dipindai adalah resi (AWB), bukan nomor pesanan.`,
    );
  }

  const order = await prisma.order.findUnique({
    where: { id: found.id },
    include: {
      fulfillmentOrders: {
        where: { status: { notIn: ['COMPLETED'] } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true, status: true },
      },
      items: { include: { variant: { select: { sku: true } } } },
      shipments: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, awb: true } },
    },
  });
  if (!order) return emptyOutcome('NOT_FOUND', `Pesanan untuk kode "${code}" tidak lagi tersedia.`);

  const summary = await buildOrderSummary(order.id);
  const fo = order.fulfillmentOrders[0] ?? null;

  if (!fo) {
    return emptyOutcome(
      'NOT_QUEUED',
      `Pesanan ${order.externalOrderId} ditemukan, tapi belum masuk antrian fulfillment. Jalankan "Proses ke Fulfillment" dulu.`,
      { order: summary },
    );
  }

  // Sudah selesai / sudah dipacking sebelumnya → idempotent. Penting: stok TIDAK
  // dipotong pada pemanggilan ini, jadi `stockDeducted` harus `false` supaya UI
  // dan SSE tidak pernah mengklaim pengurangan yang tidak terjadi.
  if (fo.status === 'HANDED_OVER') {
    return emptyOutcome(
      'ALREADY_HANDED_OVER',
      `Pesanan ${order.externalOrderId} sudah diserahkan ke kurir. Stok sudah dikurangi sebelumnya.`,
      { order: summary },
    );
  }
  if (fo.status === 'PACKED' || fo.status === 'READY_TO_SHIP') {
    return emptyOutcome(
      'ALREADY_PACKED',
      `Pesanan ${order.externalOrderId} sudah pernah dipacking — stok tidak dikurangi ulang.`,
      { order: summary },
    );
  }
  if (fo.status === 'EXCEPTION') {
    return emptyOutcome(
      'EXCEPTION',
      `Pesanan ${order.externalOrderId} berstatus EXCEPTION. Periksa di halaman Fulfillment sebelum dipacking.`,
      { order: summary },
    );
  }

  const shipment = order.shipments[0] ?? null;

  if (!shipment) {
    return emptyOutcome(
      'NEEDS_SHIPMENT',
      `Pesanan ${order.externalOrderId} belum punya pengiriman. Klik "Ambil Resi dari Shopee" terlebih dahulu.`,
      { order: summary },
    );
  }

  const isAwbScan = shipment.awb !== null && shipment.awb === code;
  if (!isAwbScan) {
    return emptyOutcome(
      'EXCEPTION',
      `Kode "${code}" bukan nomor resi pesanan ${order.externalOrderId}. Pilih barcode resi yang tercetak pada paket.`,
      { order: summary },
    );
  }

  // WAITING_STOCK / READY_TO_PICK / PICKING / PICKED / PACKING
  const preparation = await prepareFulfillmentForPacking(tenantId, fo.id, actorId, {
    confirmPicking: options.confirmPicking,
    allowNegativeStock: options.allowNegativeStock,
  });

  if (!preparation.readyForPacking) {
    if (preparation.shortfalls.length > 0) {
      const detail = preparation.shortfalls
        .map((s) => `${s.sku} (butuh ${s.required}, tersedia ${s.available}, kurang ${s.missing})`)
        .join('; ');
      return emptyOutcome(
        'WAITING_STOCK',
        `Stok belum cukup untuk pesanan ${order.externalOrderId}: ${detail}. Lengkapi stok dulu, atau pilih "Tetap packing (stok jadi minus)".`,
        { order: summary, shortfalls: preparation.shortfalls, needsConfirmation: 'NEGATIVE_STOCK' },
      );
    }
    return emptyOutcome(
      'NEEDS_PICKING',
      `Picking pesanan ${order.externalOrderId} belum selesai — ${preparation.pendingPicking.length} item belum dikonfirmasi. Scan produknya, atau pilih "Packing cepat".`,
      { order: summary, pendingPicking: preparation.pendingPicking, needsConfirmation: 'PICKING' },
    );
  }

  // Stok PASTI terpotong di dalam completePacking (satu-satunya pintu pengurangan stok).
  const packing = await completePacking(
    tenantId,
    fo.id,
    actorId,
    `Packing via scan resi: ${code}`,
    { allowNegativeStock: options.allowNegativeStock },
  );

  const updatedSummary = await buildOrderSummary(order.id);

  logger.info('Scan resi berhasil dipacking', {
    orderId: order.id,
    fulfillmentOrderId: fo.id,
    deductedUnits: packing.totalUnits,
    negativeStock: packing.negativeStock,
  });

  return {
    code: 'PACKED',
    message: packing.negativeStock
      ? `Pesanan ${order.externalOrderId} dipacking. Stok dikurangi ${packing.totalUnits} unit (ada stok minus — sesuai konfirmasi operator).`
      : `Pesanan ${order.externalOrderId} selesai dipacking. Stok gudang dikurangi ${packing.totalUnits} unit.`,
    stockDeducted: true,
    deductedUnits: packing.totalUnits,
    needsConfirmation: null,
    pendingPicking: [],
    shortfalls: [],
    order: updatedSummary,
  };
}
