import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/shared/infrastructure/prisma';
import {
  completePacking,
  handOverToCarrier,
  getOrderShortfalls,
} from './fulfillment.usecase';

/**
 * Unit test untuk aturan paling sensitif di sistem: kapan stok berkurang.
 *
 * Prinsip yang dikunci di sini:
 *  - Stok hanya berkurang di completePacking (satu pintu).
 *  - handOverToCarrier TIDAK PERNAH mengurangi stok lagi (tidak ada potong dobel).
 *  - Kalau stok belum terpotong, handover menolak dengan error jelas.
 */
vi.mock('@/shared/infrastructure/prisma', () => {
  const tx = {
    inventoryBalance: { upsert: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    inventoryMovement: { create: vi.fn() },
    stockLot: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), update: vi.fn() },
    stockReservation: { update: vi.fn() },
    orderItem: { update: vi.fn() },
    fulfillmentOrder: { update: vi.fn(), updateMany: vi.fn() },
    packingTask: { create: vi.fn() },
    pickingTask: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    pickingItem: { update: vi.fn(), updateMany: vi.fn() },
    shipment: { create: vi.fn(), update: vi.fn() },
  };
  return {
    prisma: {
      ...tx,
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'actor-1' }) },
      auditLog: { create: vi.fn() },
      fulfillmentOrder: { ...tx.fulfillmentOrder, findFirst: vi.fn(), findUniqueOrThrow: vi.fn() },
      $transaction: vi.fn(async (cb: (client: unknown) => Promise<unknown>) => cb(tx)),
    },
  };
});

const tx = prisma as unknown as {
  inventoryBalance: { upsert: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  inventoryMovement: { create: ReturnType<typeof vi.fn> };
  stockLot: { findMany: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  stockReservation: { update: ReturnType<typeof vi.fn> };
  orderItem: { update: ReturnType<typeof vi.fn> };
  fulfillmentOrder: {
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findUniqueOrThrow: ReturnType<typeof vi.fn>;
  };
  packingTask: { create: ReturnType<typeof vi.fn> };
  shipment: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
};

const tenantId = 'tenant-1';
const fulfillmentOrderId = 'fo-1';
const actorId = 'cmu5znun10001w7s4r8vgxj71';

function mockFulfillmentOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: fulfillmentOrderId,
    orderId: 'ord-1',
    warehouseId: 'wh-1',
    status: 'PICKED',
    pickingTasks: [{ items: [{ id: 'pi-1', isConfirmed: true }] }],
    order: {
      id: 'ord-1',
      items: [
        {
          id: 'item-1',
          variantId: 'var-1',
          quantity: 2,
          fulfilledQuantity: 0,
          variant: { sku: 'SKU-1' },
          reservations: [{ id: 'res-1', warehouseId: 'wh-1', quantity: 2, status: 'ACTIVE' }],
        },
      ],
      shipments: [],
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  tx.inventoryBalance.upsert.mockResolvedValue({ onHand: 8 });
  tx.stockLot.findMany.mockResolvedValue([]);
  tx.stockLot.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
    id: 'lot-opening',
    receivedAt: new Date(0),
    ...args.data,
  }));
  tx.fulfillmentOrder.update.mockResolvedValue({});
  tx.fulfillmentOrder.updateMany.mockResolvedValue({ count: 1 });
  tx.packingTask.create.mockResolvedValue({});
});

describe('completePacking — satu-satunya pintu pengurangan stok', () => {
  it('mengurangi stok fisik, menulis ledger DEDUCTION, dan mengembalikan detail potongan', async () => {
    tx.fulfillmentOrder.findFirst.mockResolvedValue(mockFulfillmentOrder());

    const result = await completePacking(tenantId, fulfillmentOrderId, actorId);

    expect(tx.inventoryBalance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { warehouseId_variantId: { warehouseId: 'wh-1', variantId: 'var-1' } },
        update: { onHand: { decrement: 2 }, version: { increment: 1 } },
      }),
    );
    expect(tx.inventoryMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ movementType: 'DEDUCTION', quantityDelta: -2, referenceId: 'ord-1' }),
      }),
    );
    expect(result).toMatchObject({ totalUnits: 2, negativeStock: false });
    expect(result.deducted[0]).toMatchObject({ sku: 'SKU-1', quantity: 2, onHand: 8 });
    expect(tx.fulfillmentOrder.update).toHaveBeenCalledWith({
      where: { id: fulfillmentOrderId },
      data: { status: 'PACKED' },
    });
  });

  it('menandai negativeStock saat saldo gudang menjadi minus', async () => {
    tx.fulfillmentOrder.findFirst.mockResolvedValue(mockFulfillmentOrder());
    tx.inventoryBalance.upsert.mockResolvedValue({ onHand: -1 });

    const result = await completePacking(tenantId, fulfillmentOrderId, actorId, 'stok kurang', {
      allowNegativeStock: true,
    });

    expect(result.negativeStock).toBe(true);
    expect(tx.inventoryMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reason: expect.stringContaining('walau kurang') }),
      }),
    );
  });

  it('mengonsumsi lot FIFO: batch terlama diambil lebih dulu', async () => {
    tx.fulfillmentOrder.findFirst.mockResolvedValue(mockFulfillmentOrder());
    tx.stockLot.findMany.mockResolvedValue([
      { id: 'lot-lama', remaining: 1, receivedAt: new Date('2026-09-01T00:00:00Z'), source: 'RECEIVE' },
      { id: 'lot-baru', remaining: 5, receivedAt: new Date('2026-09-20T00:00:00Z'), source: 'RECEIVE' },
    ]);

    const result = await completePacking(tenantId, fulfillmentOrderId, actorId);

    // Butuh 2 unit: 1 dari batch lama, 1 dari batch baru.
    expect(tx.stockLot.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'lot-lama' },
      data: { remaining: { decrement: 1 } },
    });
    expect(tx.stockLot.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'lot-baru' },
      data: { remaining: { decrement: 1 } },
    });
    expect(result.deducted[0]).toMatchObject({ lotId: 'lot-lama', lotCount: 2 });
    expect(tx.inventoryMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ stockLotId: 'lot-lama' }) }),
    );
  });

  it('menolak packing kalau masih ada item picking yang belum dikonfirmasi', async () => {
    tx.fulfillmentOrder.findFirst.mockResolvedValue(
      mockFulfillmentOrder({ pickingTasks: [{ items: [{ id: 'pi-1', isConfirmed: false }] }] }),
    );

    await expect(completePacking(tenantId, fulfillmentOrderId, actorId)).rejects.toThrow(
      'belum dikonfirmasi',
    );
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('menolak dua operator yang memindai resi bersamaan: stok tidak boleh terpotong dua kali', async () => {
    tx.fulfillmentOrder.findFirst.mockResolvedValue(mockFulfillmentOrder());
    // Simulasi scan kedua yang tiba bersamaan: update bersyarat tidak cocok lagi.
    tx.fulfillmentOrder.updateMany.mockResolvedValue({ count: 0 });

    await expect(completePacking(tenantId, fulfillmentOrderId, actorId)).rejects.toThrow(
      'operator lain',
    );
    expect(tx.inventoryBalance.upsert).not.toHaveBeenCalled();
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('mengubah status ke PACKING sebelum memotong stok sebagai kunci pembuka', async () => {
    tx.fulfillmentOrder.findFirst.mockResolvedValue(mockFulfillmentOrder({ status: 'PICKED' }));

    await completePacking(tenantId, fulfillmentOrderId, actorId);

    expect(tx.fulfillmentOrder.updateMany).toHaveBeenCalledWith({
      where: { id: fulfillmentOrderId, status: 'PICKED' },
      data: { status: 'PACKING' },
    });
    const claimOrder = tx.fulfillmentOrder.updateMany.mock.invocationCallOrder[0]!;
    const firstDeduction = tx.inventoryMovement.create.mock.invocationCallOrder[0]!;
    expect(claimOrder).toBeLessThan(firstDeduction);
  });

  it('menolak transisi tidak sah (WAITING_STOCK → PACKED) tanpa menyentuh stok', async () => {
    tx.fulfillmentOrder.findFirst.mockResolvedValue(
      mockFulfillmentOrder({ status: 'WAITING_STOCK', pickingTasks: [] }),
    );

    await expect(completePacking(tenantId, fulfillmentOrderId, actorId)).rejects.toThrow(
      'Tidak dapat mengubah status',
    );
    expect(tx.inventoryBalance.upsert).not.toHaveBeenCalled();
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
  });
});

describe('handOverToCarrier — tidak boleh memotong stok lagi', () => {
  it('menolak serah terima kalau stok belum terpotong (guard fail-fast)', async () => {
    tx.fulfillmentOrder.findFirst.mockResolvedValue(
      mockFulfillmentOrder({
        status: 'READY_TO_SHIP',
        order: { id: 'ord-1', items: [{ id: 'item-1', quantity: 2, fulfilledQuantity: 0 }], shipments: [] },
      }),
    );

    await expect(handOverToCarrier(tenantId, fulfillmentOrderId, actorId)).rejects.toThrow(
      'Stok belum dikurangi',
    );
    expect(tx.inventoryBalance.update).not.toHaveBeenCalled();
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('menerima pesanan PACKED saat operator langsung menyerahkan ke kurir', async () => {
    tx.fulfillmentOrder.findFirst.mockResolvedValue(
      mockFulfillmentOrder({
        status: 'PACKED',
        order: {
          id: 'ord-1',
          items: [{ id: 'item-1', quantity: 2, fulfilledQuantity: 2 }],
          shipments: [{ id: 'shp-1', awb: 'SPXID123', carrier: 'SPX Express', status: 'READY_TO_SHIP' }],
        },
      }),
    );

    const result = await handOverToCarrier(tenantId, fulfillmentOrderId, actorId, 'SPX Express', 'SPXID123');

    expect(result.shipmentId).toBe('shp-1');
    expect(tx.fulfillmentOrder.update).toHaveBeenNthCalledWith(1, {
      where: { id: fulfillmentOrderId },
      data: { status: 'READY_TO_SHIP' },
    });
    expect(tx.fulfillmentOrder.update).toHaveBeenNthCalledWith(2, {
      where: { id: fulfillmentOrderId },
      data: { status: 'HANDED_OVER', completedAt: expect.any(Date) },
    });
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('menerima pesanan READY_TO_SHIP saat operator menyerahkan ke kurir tanpa potong stok lagi', async () => {
    tx.fulfillmentOrder.findFirst.mockResolvedValue(
      mockFulfillmentOrder({
        status: 'READY_TO_SHIP',
        order: {
          id: 'ord-1',
          items: [{ id: 'item-1', quantity: 2, fulfilledQuantity: 2 }],
          shipments: [{ id: 'shp-1', awb: 'SPXID123', carrier: 'SPX Express', status: 'READY_TO_SHIP' }],
        },
      }),
    );
    tx.shipment.update.mockResolvedValue({ id: 'shp-1', awb: 'SPXID123', carrier: 'SPX Express' });

    const result = await handOverToCarrier(tenantId, fulfillmentOrderId, actorId, 'SPX Express', 'SPXID123');

    expect(result.shipmentId).toBe('shp-1');
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
    expect(tx.inventoryBalance.update).not.toHaveBeenCalled();
    expect(tx.fulfillmentOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'HANDED_OVER' }) }),
    );
  });

  it('menerima shipment PICKED_UP dari Shopee saat operator menyerahkan paket', async () => {
    tx.fulfillmentOrder.findFirst.mockResolvedValue(
      mockFulfillmentOrder({
        status: 'READY_TO_SHIP',
        order: {
          id: 'ord-1',
          items: [{ id: 'item-1', quantity: 2, fulfilledQuantity: 2 }],
          shipments: [{ id: 'shp-1', awb: 'SPXID123', carrier: 'SPX Express', status: 'PICKED_UP' }],
        },
      }),
    );

    const result = await handOverToCarrier(tenantId, fulfillmentOrderId, actorId, 'SPX Express', 'SPXID123');

    expect(result.shipmentId).toBe('shp-1');
    expect(tx.fulfillmentOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'HANDED_OVER' }) }),
    );
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('menolak handover yang dimulai dari status selain PACKED atau READY_TO_SHIP', async () => {
    tx.fulfillmentOrder.findFirst.mockResolvedValue(
      mockFulfillmentOrder({
        status: 'PICKED',
        order: {
          id: 'ord-1',
          items: [{ id: 'item-1', quantity: 2, fulfilledQuantity: 2 }],
          shipments: [{ id: 'shp-1', awb: 'SPXID123', carrier: 'SPX Express', status: 'READY_TO_SHIP' }],
        },
      }),
    );

    await expect(handOverToCarrier(tenantId, fulfillmentOrderId, actorId, 'SPX Express', 'SPXID123')).rejects.toThrow(
      'belum siap diserahkan',
    );
    expect(tx.fulfillmentOrder.update).not.toHaveBeenCalled();
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
  });
});

describe('getOrderShortfalls — transparansi kekurangan stok', () => {
  it('melaporkan item yang stoknya kurang beserta jumlah yang kurang', async () => {
    tx.inventoryBalance.findMany.mockResolvedValue([
      { warehouseId: 'wh-1', variantId: 'var-1', onHand: 5, reserved: 4, blocked: 0 },
      { warehouseId: 'wh-1', variantId: 'var-2', onHand: 10, reserved: 0, blocked: 0 },
    ]);

    const shortfalls = await getOrderShortfalls(tenantId, 'wh-1', [
      { variantId: 'var-1', quantity: 3, fulfilledQuantity: 0, variant: { sku: 'SKU-1', product: { name: 'Helm' } } },
      { variantId: 'var-2', quantity: 2, fulfilledQuantity: 0, variant: { sku: 'SKU-2', product: { name: 'Jaket' } } },
    ]);

    expect(shortfalls).toHaveLength(1);
    expect(shortfalls[0]).toMatchObject({ sku: 'SKU-1', required: 3, available: 1, missing: 2 });
  });

  it('tidak melaporkan apa pun kalau stok cukup', async () => {
    tx.inventoryBalance.findMany.mockResolvedValue([
      { warehouseId: 'wh-1', variantId: 'var-1', onHand: 9, reserved: 0, blocked: 0 },
    ]);

    const shortfalls = await getOrderShortfalls(tenantId, 'wh-1', [
      { variantId: 'var-1', quantity: 3, fulfilledQuantity: 0, variant: { sku: 'SKU-1' } },
    ]);

    expect(shortfalls).toHaveLength(0);
  });
});
