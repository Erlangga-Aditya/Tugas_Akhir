import { Prisma, FulfillmentStatus } from '@prisma/client';
import { prisma } from '@/shared/infrastructure/prisma';
import {
  isValidFulfillmentTransition,
  type FulfillmentStatus as DomainFulfillmentStatus,
} from '../domain/fulfillment.entity';
import {
  NotFoundError,
  InvalidStateTransitionError,
  BusinessRuleViolationError,
} from '@/shared/errors/AppError';
import { auditLog } from '@/modules/audit/application/auditLog.service';
import {
  reserveStock,
  getAvailabilityMap,
} from '@/modules/inventory/application/inventory.usecase';
import { consumeStockLotsFifo } from '@/modules/inventory/application/stock-lot.service';
import { recalculateOrderPriority } from '@/modules/orders/application/order.usecase';
import { logger } from '@/shared/observability/logger';

/** Item yang stoknya belum cukup untuk sebuah pesanan. */
export interface StockShortfall {
  variantId: string;
  sku: string;
  productName: string;
  required: number;
  available: number;
  missing: number;
}

/** Item picking yang belum dikonfirmasi oleh operator. */
export interface PendingPickingItem {
  pickingItemId: string;
  sku: string;
  variantName: string;
  expectedQuantity: number;
  pickedQuantity: number;
}

/**
 * Hasil penyiapan packing: apakah pesanan boleh lanjut ke packing, dan kalau
 * BELUM boleh — apa persisnya yang kurang (dipakai UI supaya pesannya jujur).
 */
export interface PackingPreparation {
  fulfillmentOrderId: string;
  orderId: string;
  warehouseId: string;
  status: FulfillmentStatus;
  readyForPacking: boolean;
  pendingPicking: PendingPickingItem[];
  shortfalls: StockShortfall[];
  autoConfirmedPicking: boolean;
  reservedNow: boolean;
  usedNegativeStock: boolean;
}

function assertTransition(from: string, to: DomainFulfillmentStatus, entity = 'Fulfillment Order') {
  if (!isValidFulfillmentTransition(from as DomainFulfillmentStatus, to)) {
    throw new InvalidStateTransitionError(entity, from, to);
  }
}

/**
 * Reserve stock for a CONFIRMED order and create the fulfillment order.
 * Idempotent. If all items reserve → READY_TO_PICK, else WAITING_STOCK.
 * FR-RES-001/002, FR-FUL-001/002.
 */
export async function processOrderForFulfillment(
  tenantId: string,
  orderId: string,
  warehouseId: string,
  actorId: string,
): Promise<{ fulfillmentOrderId: string; success: boolean; failedSkus: string[] }> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, tenantId },
    include: { items: { include: { variant: { select: { sku: true } } } } },
  });
  if (!order) throw new NotFoundError('Pesanan', orderId);
  if (order.status !== 'CONFIRMED') {
    throw new BusinessRuleViolationError(
      `Hanya pesanan CONFIRMED yang dapat diproses. Status saat ini: ${order.status}.`,
    );
  }

  const existing = await prisma.fulfillmentOrder.findFirst({
    where: { orderId, status: { notIn: ['COMPLETED', 'EXCEPTION'] } },
  });
  if (existing) return { fulfillmentOrderId: existing.id, success: existing.status !== 'WAITING_STOCK', failedSkus: [] };

  // Reserve each item (idempotent per order item).
  const failedSkus: string[] = [];
  for (const item of order.items) {
    try {
      await reserveStock(tenantId, warehouseId, item.variantId, item.id, item.quantity, actorId);
    } catch {
      failedSkus.push(item.variant.sku);
    }
  }

  const status: FulfillmentStatus = failedSkus.length > 0 ? 'WAITING_STOCK' : 'READY_TO_PICK';

  const fo = await prisma.$transaction(async (tx) => {
    const fulfillmentOrder = await tx.fulfillmentOrder.create({
      data: { orderId, warehouseId, status },
    });
    if (status === 'READY_TO_PICK') {
      await tx.pickingTask.create({
        data: {
          fulfillmentOrderId: fulfillmentOrder.id,
          status: 'PENDING',
          items: {
            create: order.items.map((item) => ({
              variantId: item.variantId,
              expectedQuantity: item.quantity,
              pickedQuantity: 0,
            })),
          },
        },
      });
    }
    return fulfillmentOrder;
  });

  await recalculateOrderPriority(tenantId, orderId);

  await auditLog({
    tenantId,
    actorId,
    action: 'fulfillment_order_created',
    entityType: 'FulfillmentOrder',
    entityId: fo.id,
    metadata: { orderId, warehouseId, status, failedSkus },
  });

  return { fulfillmentOrderId: fo.id, success: failedSkus.length === 0, failedSkus };
}

// ─────────────────────────────────────────────────────────────────────────────
// Kesiapan packing (single source of truth untuk scan resi & tombol UI)
// ─────────────────────────────────────────────────────────────────────────────

/** Rantai status yang sah menuju PICKED, dipakai untuk memajukan status tanpa melompati state machine. */
const CHAIN_TO_PICKED: Record<string, DomainFulfillmentStatus[]> = {
  WAITING_STOCK: ['READY_TO_PICK', 'PICKING', 'PICKED'],
  READY_TO_PICK: ['PICKING', 'PICKED'],
  PICKING: ['PICKED'],
};

/** Pastikan picking task + item-nya ada (WAITING_STOCK tidak dibuatkan task saat reservasi gagal). */
async function ensurePickingTask(
  tx: Prisma.TransactionClient,
  fulfillmentOrderId: string,
  items: Array<{ variantId: string; expectedQuantity: number }>,
) {
  const existing = await tx.pickingTask.findFirst({ where: { fulfillmentOrderId } });
  if (existing) return existing;
  return tx.pickingTask.create({
    data: {
      fulfillmentOrderId,
      status: 'PENDING',
      items: {
        create: items.map((i) => ({
          variantId: i.variantId,
          expectedQuantity: i.expectedQuantity,
          pickedQuantity: 0,
        })),
      },
    },
  });
}

/** Majukan fulfillment order sampai PICKED mengikuti transisi yang sah (tanpa bypass state machine). */
async function advanceToPicked(tx: Prisma.TransactionClient, fulfillmentOrderId: string, from: string) {
  const chain = CHAIN_TO_PICKED[from];
  if (!chain) return;
  let current = from;
  for (const step of chain) {
    assertTransition(current, step);
    await tx.fulfillmentOrder.update({
      where: { id: fulfillmentOrderId },
      data: { status: step, ...(step === 'PICKING' ? { startedAt: new Date() } : {}) },
    });
    current = step;
  }
  await tx.pickingTask.updateMany({
    where: { fulfillmentOrderId, status: { in: ['PENDING', 'IN_PROGRESS'] } },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });
}

/**
 * Konfirmasi seluruh item picking untuk sebuah fulfillment order.
 * DIPANGGIL HANYA dari aksi eksplisit operator (mode cepat) — selalu tercatat di audit log
 * supaya jejak "item dikonfirmasi tanpa scan" tidak pernah tersembunyi.
 */
export async function confirmAllPickingItems(
  tenantId: string,
  fulfillmentOrderId: string,
  actorId: string,
  reason: string,
): Promise<number> {
  const fo = await prisma.fulfillmentOrder.findFirst({
    where: { id: fulfillmentOrderId, order: { tenantId } },
    include: { pickingTasks: { include: { items: true } } },
  });
  if (!fo) throw new NotFoundError('Fulfillment order', fulfillmentOrderId);

  const pending = fo.pickingTasks.flatMap((t) => t.items).filter((i) => !i.isConfirmed);
  if (pending.length === 0) return 0;

  await prisma.$transaction(async (tx) => {
    for (const item of pending) {
      await tx.pickingItem.update({
        where: { id: item.id },
        data: { isConfirmed: true, pickedQuantity: item.expectedQuantity, scannedAt: new Date() },
      });
    }
  });

  await auditLog({
    tenantId,
    actorId,
    action: 'picking_confirmed_without_scan',
    entityType: 'FulfillmentOrder',
    entityId: fulfillmentOrderId,
    metadata: { reason, confirmedItems: pending.length },
  });

  return pending.length;
}

/**
 * Hitung item mana yang stoknya kurang untuk sebuah pesanan (dipakai UI agar shortfall transparan).
 */
export async function getOrderShortfalls(
  tenantId: string,
  warehouseId: string,
  orderItems: Array<{
    variantId: string;
    quantity: number;
    fulfilledQuantity: number;
    variant?: { sku: string; product?: { name: string } | null } | null;
    /** Reservasi AKTIF milik item ini — stok yang sudah "dipesan" untuk pesanan ini sendiri. */
    reservations?: Array<{ quantity: number }> | null;
  }>,
): Promise<StockShortfall[]> {
  const needs = orderItems
    .map((i) => ({ ...i, required: i.quantity - i.fulfilledQuantity }))
    .filter((i) => i.required > 0);
  if (needs.length === 0) return [];

  const availability = await getAvailabilityMap([warehouseId], [...new Set(needs.map((i) => i.variantId))]);
  const shortfalls: StockShortfall[] = [];
  for (const item of needs) {
    // PENTING: `available` sudah dikurangi reservasi milik pesanan ini sendiri.
    // Karena itu reservasi sendiri harus ditambahkan kembali — kalau tidak, pesanan
    // yang sudah teralokasi akan selalu terlihat "kurang stok".
    const ownReservation = (item.reservations ?? []).reduce((sum, r) => sum + r.quantity, 0);
    const available =
      (availability.get(`${warehouseId}:${item.variantId}`)?.available ?? 0) + ownReservation;
    if (available < item.required) {
      shortfalls.push({
        variantId: item.variantId,
        sku: item.variant?.sku ?? item.variantId,
        productName: item.variant?.product?.name ?? item.variant?.sku ?? 'Produk',
        required: item.required,
        available,
        missing: item.required - available,
      });
    }
  }
  return shortfalls;
}

/**
 * Siapkan sebuah fulfillment order agar boleh dipacking:
 *  1. WAITING_STOCK → coba alokasikan stok ulang, supaya pesanan tidak macet selamanya.
 *  2. Pastikan picking task ada; konfirmasi item hanya kalau operator memintanya (confirmPicking).
 *  3. Majukan status ke PICKED lewat transisi yang sah.
 *
 * Mengembalikan alasan yang jelas kalau belum boleh dipacking — TIDAK PERNAH mengubah stok.
 */
export async function prepareFulfillmentForPacking(
  tenantId: string,
  fulfillmentOrderId: string,
  actorId: string,
  options: { confirmPicking?: boolean; allowNegativeStock?: boolean } = {},
): Promise<PackingPreparation> {
  const fo = await prisma.fulfillmentOrder.findFirst({
    where: { id: fulfillmentOrderId, order: { tenantId } },
    include: {
      order: {
        include: {
          items: {
            include: {
              variant: { include: { product: { select: { name: true } } } },
              reservations: { where: { status: 'ACTIVE' }, select: { quantity: true } },
            },
          },
        },
      },
      pickingTasks: { include: { items: { include: { variant: true } } } },
    },
  });
  if (!fo) throw new NotFoundError('Fulfillment order', fulfillmentOrderId);
  if (fo.status === 'HANDED_OVER' || fo.status === 'COMPLETED') {
    throw new BusinessRuleViolationError('Pesanan ini sudah diserahkan ke kurir / sudah selesai.');
  }

  let status: string = fo.status;
  let reservedNow = false;
  let shortfalls = await getOrderShortfalls(tenantId, fo.warehouseId, fo.order.items);

  // 1. WAITING_STOCK → coba alokasikan ulang sebelum menyerah.
  if (status === 'WAITING_STOCK' && shortfalls.length > 0) {
    const stillFailed: string[] = [];
    for (const item of fo.order.items) {
      const remaining = item.quantity - item.fulfilledQuantity;
      if (remaining <= 0) continue;
      try {
        await reserveStock(tenantId, fo.warehouseId, item.variantId, item.id, remaining, actorId);
      } catch {
        stillFailed.push(item.variant.sku);
      }
    }
    if (stillFailed.length === 0) {
      await prisma.$transaction(async (tx) => {
        await ensurePickingTask(
          tx,
          fo.id,
          fo.order.items.map((i) => ({ variantId: i.variantId, expectedQuantity: i.quantity })),
        );
        assertTransition(status, 'READY_TO_PICK');
        await tx.fulfillmentOrder.update({ where: { id: fo.id }, data: { status: 'READY_TO_PICK' } });
      });
      status = 'READY_TO_PICK';
      reservedNow = true;
      shortfalls = [];
      await auditLog({
        tenantId,
        actorId,
        action: 'stock_reserved_retry_success',
        entityType: 'FulfillmentOrder',
        entityId: fo.id,
        metadata: { warehouseId: fo.warehouseId },
      });
    }
  }

  if (shortfalls.length > 0 && !options.allowNegativeStock) {
    return {
      fulfillmentOrderId: fo.id,
      orderId: fo.orderId,
      warehouseId: fo.warehouseId,
      status: status as FulfillmentStatus,
      readyForPacking: false,
      pendingPicking: [],
      shortfalls,
      autoConfirmedPicking: false,
      reservedNow,
      usedNegativeStock: false,
    };
  }

  // 2. Pastikan picking task ada (mis. lanjut packing walau stok minus).
  await prisma.$transaction(async (tx) => {
    await ensurePickingTask(
      tx,
      fo.id,
      fo.order.items.map((i) => ({ variantId: i.variantId, expectedQuantity: i.quantity })),
    );
  });

  const refresh = async () =>
    prisma.fulfillmentOrder.findUniqueOrThrow({
      where: { id: fo.id },
      include: { pickingTasks: { include: { items: { include: { variant: true } } } } },
    });

  let current = await refresh();
  let pending = current.pickingTasks.flatMap((t) => t.items).filter((i) => !i.isConfirmed);
  let autoConfirmedPicking = false;

  // 3. Konfirmasi picking hanya atas permintaan operator (mode cepat) — bukan diam-diam.
  if (pending.length > 0 && options.confirmPicking) {
    await confirmAllPickingItems(tenantId, fo.id, actorId, 'operator-fast-mode');
    autoConfirmedPicking = true;
    current = await refresh();
    pending = current.pickingTasks.flatMap((t) => t.items).filter((i) => !i.isConfirmed);
  }

  if (pending.length > 0) {
    return {
      fulfillmentOrderId: fo.id,
      orderId: fo.orderId,
      warehouseId: fo.warehouseId,
      status: current.status,
      readyForPacking: false,
      pendingPicking: pending.map((i) => ({
        pickingItemId: i.id,
        sku: i.variant.sku,
        variantName: i.variant.name,
        expectedQuantity: i.expectedQuantity,
        pickedQuantity: i.pickedQuantity,
      })),
      shortfalls: [],
      autoConfirmedPicking: false,
      reservedNow,
      usedNegativeStock: false,
    };
  }

  // Semua item sudah dikonfirmasi → majukan ke PICKED.
  if (current.status !== 'PICKED' && current.status !== 'PACKING') {
    await prisma.$transaction(async (tx) => {
      await advanceToPicked(tx, fo.id, current.status);
    });
  }

  return {
    fulfillmentOrderId: fo.id,
    orderId: fo.orderId,
    warehouseId: fo.warehouseId,
    status: 'PICKED',
    readyForPacking: true,
    pendingPicking: [],
    shortfalls,
    autoConfirmedPicking,
    reservedNow,
    usedNegativeStock: options.allowNegativeStock === true && shortfalls.length > 0,
  };
}

/**
 * Coba alokasikan stok untuk semua pesanan WAITING_STOCK di sebuah gudang.
 * Dipanggil otomatis setelah stok masuk/disesuaikan, dan bisa dipicu manual dari UI.
 * Tanpa ini, pesanan yang gagal reservasi akan macet selamanya.
 */
export async function retryWaitingStockOrders(
  tenantId: string,
  warehouseId: string,
  actorId: string,
): Promise<{ advanced: string[]; stillWaiting: string[] }> {
  const waiting = await prisma.fulfillmentOrder.findMany({
    where: { order: { tenantId }, warehouseId, status: 'WAITING_STOCK' },
    include: { order: { include: { items: true } } },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });

  const advanced: string[] = [];
  const stillWaiting: string[] = [];

  for (const fo of waiting) {
    let ok = true;
    for (const item of fo.order.items) {
      const remaining = item.quantity - item.fulfilledQuantity;
      if (remaining <= 0) continue;
      try {
        await reserveStock(tenantId, warehouseId, item.variantId, item.id, remaining, actorId);
      } catch {
        ok = false;
        break;
      }
    }

    if (!ok) {
      stillWaiting.push(fo.id);
      continue;
    }

    await prisma.$transaction(async (tx) => {
      await ensurePickingTask(
        tx,
        fo.id,
        fo.order.items.map((i) => ({ variantId: i.variantId, expectedQuantity: i.quantity })),
      );
      assertTransition('WAITING_STOCK', 'READY_TO_PICK');
      await tx.fulfillmentOrder.update({ where: { id: fo.id }, data: { status: 'READY_TO_PICK' } });
    });
    advanced.push(fo.id);
  }

  if (advanced.length > 0) {
    await auditLog({
      tenantId,
      actorId,
      action: 'waiting_stock_retry',
      entityType: 'Warehouse',
      entityId: warehouseId,
      metadata: { advanced: advanced.length, stillWaiting: stillWaiting.length },
    });
    logger.info(
      `Retry alokasi stok: ${advanced.length} pesanan siap dipick, ${stillWaiting.length} masih menunggu`,
      { warehouseId },
    );
  }

  return { advanced, stillWaiting };
}

export async function completePacking(
  tenantId: string,
  fulfillmentOrderId: string,
  actorId: string,
  notes?: string,
  options: { allowNegativeStock?: boolean } = {},
): Promise<{
  deducted: Array<{
    variantId: string;
    sku: string;
    quantity: number;
    onHand: number;
    /** Lot FIFO mana yang dipakai (terlama lebih dulu). */
    lotId: string | null;
    lotCount: number;
  }>;
  totalUnits: number;
  negativeStock: boolean;
}> {
  const fo = await prisma.fulfillmentOrder.findFirst({
    where: { id: fulfillmentOrderId, order: { tenantId } },
    include: {
      pickingTasks: { include: { items: true } },
      order: {
        include: {
          items: {
            include: {
              reservations: { where: { status: 'ACTIVE' } },
              variant: { select: { sku: true } },
            },
          },
        },
      },
    },
  });
  if (!fo) throw new NotFoundError('Fulfillment order', fulfillmentOrderId);

  const allItems = fo.pickingTasks.flatMap((t) => t.items);
  const unconfirmed = allItems.filter((i) => !i.isConfirmed);
  if (unconfirmed.length > 0) {
    throw new BusinessRuleViolationError(
      `${unconfirmed.length} item belum dikonfirmasi. Selesaikan picking terlebih dahulu.`,
      { unconfirmedCount: unconfirmed.length },
    );
  }
  assertTransition(fo.status, 'PACKED');

  const deducted: Array<{
    variantId: string;
    sku: string;
    quantity: number;
    onHand: number;
    lotId: string | null;
    lotCount: number;
  }> = [];

  await prisma.$transaction(async (tx) => {
    // 0. KUNCI-LAHAN: claim status di awal transaksi dengan update bersyarat.
    // Tanpa ini dua scan paralel (kamera + USB scanner, atau dua operator) sama-sama
    // membaca status lama, lalu masing-masing memotong stok → stok berkurang dobel.
    const claimed = await tx.fulfillmentOrder.updateMany({
      where: { id: fulfillmentOrderId, status: fo.status },
      data: { status: 'PACKING' },
    });
    if (claimed.count === 0) {
      throw new BusinessRuleViolationError(
        'Paket sedang atau sudah dikemas oleh operator lain. Muat ulang daftar untuk melihat status terbaru.',
        { fulfillmentOrderId, expectedStatus: fo.status },
      );
    }

    // 1. Kurangi stok fisik + konsumsi reservasi + ledger
    for (const item of fo.order.items) {
      const remaining = item.quantity - item.fulfilledQuantity;
      if (remaining > 0) {
        const balance = await tx.inventoryBalance.upsert({
          where: { warehouseId_variantId: { warehouseId: fo.warehouseId, variantId: item.variantId } },
          update: { onHand: { decrement: remaining }, version: { increment: 1 } },
          create: { warehouseId: fo.warehouseId, variantId: item.variantId, onHand: -remaining },
        });
        // FIFO: barang yang paling lama disimpan keluar lebih dulu.
        const consumedLots = await consumeStockLotsFifo(tx, {
          warehouseId: fo.warehouseId,
          variantId: item.variantId,
          quantity: remaining,
          referenceId: fo.orderId,
        });

        deducted.push({
          variantId: item.variantId,
          sku: item.variant.sku,
          quantity: remaining,
          onHand: balance.onHand,
          lotId: consumedLots[0]?.lotId ?? null,
          lotCount: consumedLots.length,
        });
        await tx.inventoryMovement.create({
          data: {
            tenantId,
            warehouseId: fo.warehouseId,
            variantId: item.variantId,
            movementType: 'DEDUCTION',
            quantityDelta: -remaining,
            referenceType: 'order',
            referenceId: fo.orderId,
            stockLotId: consumedLots[0]?.lotId ?? null,
            reason: options.allowNegativeStock
              ? 'Packing selesai — stok dikurangi walau kurang (disetujui operator)'
              : 'Packing selesai — stok fisik gudang dikurangkan',
            actorId,
          },
        });
      }

      // Reservasi (kalau ada) ditutup di sini; reserved hanya berkurang sebesar yang direservasi.
      for (const res of item.reservations) {
        await tx.inventoryBalance.update({
          where: { warehouseId_variantId: { warehouseId: res.warehouseId, variantId: item.variantId } },
          data: { reserved: { decrement: res.quantity }, version: { increment: 1 } },
        });
        await tx.stockReservation.update({ where: { id: res.id }, data: { status: 'CONSUMED' } });
      }

      await tx.orderItem.update({
        where: { id: item.id },
        data: { fulfilledQuantity: item.quantity, status: 'FULFILLED' },
      });
    }

    // 2. Selesaikan dikemas. Handover nanti menjalankan rantai transisi yang sah.
    await tx.fulfillmentOrder.update({ where: { id: fulfillmentOrderId }, data: { status: 'PACKED' } });
    await tx.packingTask.create({
      data: { fulfillmentOrderId, status: 'COMPLETED', packedById: actorId, packedAt: new Date(), notes },
    });
  });

  const negativeStock = deducted.some((d) => d.onHand < 0);

  await auditLog({
    tenantId,
    actorId,
    action: 'packing_complete',
    entityType: 'FulfillmentOrder',
    entityId: fulfillmentOrderId,
    metadata: { notes, deductedUnits: deducted.reduce((s, d) => s + d.quantity, 0), negativeStock },
  });

  return { deducted, totalUnits: deducted.reduce((s, d) => s + d.quantity, 0), negativeStock };
}

/** Mark READY_TO_SHIP (internal fulfillment complete) — FR-FUL-006. */
export async function markReadyToShip(
  tenantId: string,
  fulfillmentOrderId: string,
  actorId: string,
): Promise<void> {
  const fo = await prisma.fulfillmentOrder.findFirst({
    where: { id: fulfillmentOrderId, order: { tenantId } },
  });
  if (!fo) throw new NotFoundError('Fulfillment order', fulfillmentOrderId);
  assertTransition(fo.status, 'READY_TO_SHIP');

  await prisma.fulfillmentOrder.update({
    where: { id: fulfillmentOrderId },
    data: { status: 'READY_TO_SHIP' },
  });
  await auditLog({ tenantId, actorId, action: 'ready_to_ship', entityType: 'FulfillmentOrder', entityId: fulfillmentOrderId });
}

/**
 * Serahkan paket ke kurir: READY_TO_SHIP → HANDED_OVER.
 *
 * PENTING: stok fisik TIDAK dikurangi di sini. Pengurangan stok hanya terjadi saat packing
 * (single source of truth, lihat completePacking) — jadi tidak ada potong stok dobel.
 * Fungsi ini hanya: verifikasi stok sudah terpotong, lalu buat/pakai Shipment.
 * ADR-003 (ledger), FR-FUL-006, FR-SHP-001.
 */
export async function handOverToCarrier(
  tenantId: string,
  fulfillmentOrderId: string,
  actorId: string,
  carrier?: string,
  awb?: string,
): Promise<{ shipmentId: string }> {
  const fo = await prisma.fulfillmentOrder.findFirst({
    where: { id: fulfillmentOrderId, order: { tenantId } },
    include: {
      order: {
        include: {
          shipments: true,
          items: { select: { id: true, quantity: true, fulfilledQuantity: true } },
        },
      },
    },
  });
  if (!fo) throw new NotFoundError('Fulfillment order', fulfillmentOrderId);
  // UI satu halaman menganggap PACKED sebagai "Siap Kirim" agar operator dapat
  // langsung menyerahkan paket. Backend tetap menghormati state machine: PACKED
  // harus melewati READY_TO_SHIP lebih dulu, lalu baru HANDED_OVER.
  // UI "Siap Kirim" juga mencakup PACKED. Backend tetap menyelesaikan rantai
  // PACKED → READY_TO_SHIP → HANDED_OVER dalam SATU transaksi tanpa potongan stok kedua.
  const enteringFromPacked = fo.status === 'PACKED';
  if (enteringFromPacked) {
    assertTransition(fo.status, 'READY_TO_SHIP');
  } else if (fo.status === 'READY_TO_SHIP') {
    assertTransition(fo.status, 'HANDED_OVER');
  } else {
    throw new BusinessRuleViolationError(
      `Pesanan belum siap diserahkan ke kurir. Status saat ini: ${fo.status}.`,
      { status: fo.status },
    );
  }

  // Guard fail-fast: jangan pernah menyerahkan paket yang stoknya belum terpotong.
  const notDeducted = fo.order.items.filter((i) => i.fulfilledQuantity < i.quantity);
  if (notDeducted.length > 0) {
    throw new BusinessRuleViolationError(
      `Stok belum dikurangi untuk ${notDeducted.length} item. Selesaikan packing dulu sebelum serah terima kurir.`,
      { itemIds: notDeducted.map((i) => i.id) },
    );
  }

  const shipment = await prisma.$transaction(async (tx) => {
    if (enteringFromPacked) {
      await tx.fulfillmentOrder.update({
        where: { id: fulfillmentOrderId },
        data: { status: 'READY_TO_SHIP' },
      });
    }

    // `PICKED_UP` berarti Shopee sudah menerima permintaan pengiriman, tetapi
    // paket belum diserahkan ke kurir. Simpan sebagai `READY_TO_SHIP` sampai
    // operator menyelesaikan scan + handover.
    const activeShipment = fo.order.shipments.find(
      (s) => s.status === 'READY_TO_SHIP' || s.status === 'PENDING' || s.status === 'PICKED_UP',
    );
    if (!activeShipment) {
      throw new BusinessRuleViolationError('Data pengiriman belum tersedia. Selesaikan pengaturan pengiriman terlebih dahulu.');
    }
    const storedAwb = activeShipment.awb?.trim() || null;
    if (!storedAwb) {
      throw new BusinessRuleViolationError('Nomor resi belum tersedia. Selesaikan pengaturan pengiriman sebelum menyerahkan paket.');
    }
    if (awb && awb !== storedAwb) {
      throw new BusinessRuleViolationError('Nomor resi pada paket tidak cocok dengan data pengiriman yang tersimpan.');
    }
    if (carrier && activeShipment.carrier && carrier !== activeShipment.carrier) {
      throw new BusinessRuleViolationError('Kurir pada paket tidak cocok dengan data pengiriman yang tersimpan.');
    }

    const shipment =
      (!activeShipment.carrier || activeShipment.carrier !== carrier) && carrier
        ? await tx.shipment.update({
            where: { id: activeShipment.id },
            data: { carrier, status: 'READY_TO_SHIP' },
          })
        : activeShipment;

    await tx.fulfillmentOrder.update({
      where: { id: fulfillmentOrderId },
      data: { status: 'HANDED_OVER', completedAt: new Date() },
    });

    return shipment;
  });

  await auditLog({
    tenantId,
    actorId,
    action: 'handover_to_carrier',
    entityType: 'FulfillmentOrder',
    entityId: fulfillmentOrderId,
    metadata: { shipmentId: shipment.id, carrier, awb },
  });
  logger.info('Handover to carrier', { tenantId, fulfillmentOrderId, shipmentId: shipment.id });
  return { shipmentId: shipment.id };
}

/**
 * Tahapan alur yang dilihat operator (bahasa sehari-hari).
 *
 * `DIBATALKAN` bukan tahap kerja — pesanan ini tidak akan pernah dikemas.
 * Tetap ditampilkan supaya operator bisa melihat pesanan mana yang batal,
 * alih-alih pesanan itu hilang tanpa kabar.
 */
export type StationStage =
  | 'BARU'
  | 'MENUNGGU_STOK'
  | 'SIAP_DIKEMAS'
  | 'SIAP_KIRIM'
  | 'DIKIRIM'
  | 'DIBATALKAN';

/**
 * Data untuk SATU halaman kerja: pesanan masuk → ambil resi → scan resi → serahkan ke kurir.
 * Tidak ada lagi halaman terpisah untuk "picking/packing": alurnya scan resi saja.
 *
 * @param sort 'oldest' = pesanan terlama diproses dulu (default), 'newest' = terbaru dulu.
 */
export async function getFulfillmentStation(
  tenantId: string,
  options: { sort?: 'oldest' | 'newest' } = {},
) {
  const sortDir: 'asc' | 'desc' = options.sort === 'newest' ? 'desc' : 'asc';

  const warehouse = await prisma.warehouse.findFirst({
    where: { tenantId, status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, code: true },
  });

  const orders = await prisma.order.findMany({
    // `CANCELLED` ikut diambil supaya operator bisa melihat pesanan yang batal.
    // Pesanan batal tidak boleh hilang dari halaman — kalau hilang, operator
    // tidak pernah tahu kalau ada pembeli yang membatalkan pesanan.
    where: { tenantId, status: { in: ['NEW', 'CONFIRMED', 'CANCELLED'] } },
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
    orderBy: [{ shipByAt: sortDir }, { placedAt: sortDir }],
    take: 200,
  });

  const warehouseIds = [
    ...new Set([
      ...(warehouse ? [warehouse.id] : []),
      ...orders.map((o) => o.fulfillmentOrders[0]?.warehouseId).filter((v): v is string => Boolean(v)),
    ]),
  ];
  const availability = await getAvailabilityMap(
    warehouseIds,
    [...new Set(orders.flatMap((o) => o.items.map((i) => i.variantId)))],
  );

  const unified = orders.map((o) => {
    const fo = o.fulfillmentOrders[0] ?? null;
    const shipment = o.shipments[0] ?? null;
    const warehouseId = fo?.warehouseId ?? warehouse?.id ?? '';

    const items = o.items.map((i) => {
      const required = i.quantity - i.fulfilledQuantity;
      // Reservasi milik pesanan ini dihitung miliknya (bukan dianggap stok habis).
      const ownReservation = (i.reservations ?? []).reduce((sum, r) => sum + r.quantity, 0);
      const available = (availability.get(`${warehouseId}:${i.variantId}`)?.available ?? 0) + ownReservation;
      return {
        id: i.id,
        variantId: i.variantId,
        sku: i.variant.sku,
        variantName: i.variant.name,
        productName: i.variant.product.name,
        quantity: i.quantity,
        fulfilledQuantity: i.fulfilledQuantity,
        available,
        shortfall: required > available ? required - available : 0,
      };
    });

    // Pesanan batal tidak punya tahap kerja: tidak akan pernah dikemas, dan
    // tombol aksi (scan, ambil resi, serahkan) harus dimatikan.
    const stage: StationStage = o.status === 'CANCELLED'
      ? 'DIBATALKAN'
      : !fo
        ? 'BARU'
        : fo.status === 'WAITING_STOCK'
          ? 'MENUNGGU_STOK'
          : fo.status === 'PACKED' || fo.status === 'READY_TO_SHIP'
            ? 'SIAP_KIRIM'
            : fo.status === 'HANDED_OVER'
              ? 'DIKIRIM'
              : 'SIAP_DIKEMAS';

    const dibatalkan = o.status === 'CANCELLED';

    return {
      orderId: o.id,
      externalOrderId: o.externalOrderId,
      buyerName: o.buyerName,
      buyerPhone: o.buyerPhone,
      shopName: o.shop.name,
      provider: o.shop.provider,
      placedAt: o.placedAt,
      shipByAt: o.shipByAt,
      priorityLevel: o.priorityLevel,
      orderStatus: o.status,
      fulfillmentId: fo?.id ?? null,
      fulfillmentStatus: fo?.status ?? null,
      awb: shipment?.awb ?? null,
      carrier: shipment?.carrier ?? null,
      isCancelled: dibatalkan,
      canCancel: false,
      // Pesanan batal tidak boleh offer aksi apa pun: tidak bisa scan, tidak
      // bisa minta resi baru. Kalau tidak dijaga, operator bisa memicu
      // perubahan stok untuk pesanan yang sudah dibatalkan pembeli.
      canArrangeShipment: !dibatalkan && !shipment?.awb,
      /** Barang hanya boleh dinyatakan siap kirim setelah nomor resi terbit. */
      canPack: !dibatalkan && Boolean(shipment?.awb),
      canHandOver: !dibatalkan && fo?.status === 'READY_TO_SHIP',
      stage,
      items,
      totalUnits: items.reduce((sum, i) => sum + i.quantity, 0),
      shortfallUnits: items.reduce((sum, i) => sum + i.shortfall, 0),
    };
  });

  return {
    warehouse,
    sort: options.sort ?? 'oldest',
    stages: {
      baru: unified.filter((u) => u.stage === 'BARU').length,
      menungguStok: unified.filter((u) => u.stage === 'MENUNGGU_STOK').length,
      siapDikemas: unified.filter((u) => u.stage === 'SIAP_DIKEMAS').length,
      siapKirim: unified.filter((u) => u.stage === 'SIAP_KIRIM').length,
      dikirim: unified.filter((u) => u.stage === 'DIKIRIM').length,
      dibatalkan: unified.filter((u) => u.stage === 'DIBATALKAN').length,
    },
    orders: unified,
    generatedAt: new Date().toISOString(),
  };
}
