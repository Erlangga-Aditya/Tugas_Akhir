/* eslint-disable no-console */
/**
 * Database seed — creates a realistic, fully-populated workspace so every menu
 * has real data and the full fulfillment flow can be exercised end-to-end.
 *
 * Credentials (local dev only — change in production):
 *   owner   owner@toko.id   / Owner12345
 *   manager manager@toko.id / Manager12345
 *   staff   staff@toko.id   / Staff12345
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  const existing = await prisma.tenant.findUnique({ where: { slug: 'toko-utama' } });
  if (existing) {
    console.log('Tenant "toko-utama" already exists — skipping seed.');
    return;
  }

  const passwordHash = (pw: string) => bcrypt.hash(pw, 12);

  const [ownerHash, managerHash, staffHash] = await Promise.all([
    passwordHash('Owner12345'),
    passwordHash('Manager12345'),
    passwordHash('Staff12345'),
  ]);

  // 1. Tenant + users + memberships
  const tenant = await prisma.tenant.create({
    data: { name: 'Toko Utama', slug: 'toko-utama', status: 'ACTIVE' },
  });

  const owner = await prisma.user.create({
    data: { name: 'Pemilik Toko', email: 'owner@toko.id', passwordHash: ownerHash, status: 'ACTIVE' },
  });
  const manager = await prisma.user.create({
    data: { name: 'Manajer Gudang', email: 'manager@toko.id', passwordHash: managerHash, status: 'ACTIVE' },
  });
  const staff = await prisma.user.create({
    data: { name: 'Staff Gudang', email: 'staff@toko.id', passwordHash: staffHash, status: 'ACTIVE' },
  });

  await prisma.tenantMembership.createMany({
    data: [
      { tenantId: tenant.id, userId: owner.id, role: 'OWNER' },
      { tenantId: tenant.id, userId: manager.id, role: 'OWNER' },
      { tenantId: tenant.id, userId: staff.id, role: 'OWNER' },
    ],
  });

  // 2. Warehouse + Shop
  const warehouse = await prisma.warehouse.create({
    data: { tenantId: tenant.id, name: 'Gudang Utama', code: 'WH-01', status: 'ACTIVE' },
  });

  const shop = await prisma.shop.create({
    data: { tenantId: tenant.id, provider: 'shopee', name: 'Shopee Official Store', status: 'ACTIVE' },
  });

  // 3. Priority rule (default, explainable — ADR-005)
  await prisma.priorityRule.create({
    data: {
      tenantId: tenant.id,
      version: 'priority-v1',
      isEnabled: true,
      description: 'Aturan prioritas default (deadline, SLA, umur order, kesiapan stok)',
      criteriaJson: {
        version: 'priority-v1',
        weights: { DEADLINE_URGENT: 0.4, SLA_RISK: 0.3, STOCK_READY: 0.2, ORDER_AGE: 0.1 },
        thresholds: { critical: 80, high: 60, medium: 40 },
      },
    },
  });

  // 4. Products + variants
  const kaos = await prisma.product.create({
    data: {
      tenantId: tenant.id, name: 'Kaos Polos Premium', category: 'Pakaian', status: 'ACTIVE',
      variants: {
        create: [
          { sku: 'KAOS-S', barcode: '8991000000001', name: 'Ukuran S', weight: 180 },
          { sku: 'KAOS-M', barcode: '8991000000002', name: 'Ukuran M', weight: 180 },
          { sku: 'KAOS-L', barcode: '8991000000003', name: 'Ukuran L', weight: 180 },
        ],
      },
    },
    include: { variants: true },
  });

  const tumbler = await prisma.product.create({
    data: {
      tenantId: tenant.id, name: 'Tumbler Stainless 500ml', category: 'Peralatan', status: 'ACTIVE',
      variants: { create: [{ sku: 'TMB-500', barcode: '8991000000010', name: 'Default', weight: 350 }] },
    },
    include: { variants: true },
  });

  const tas = await prisma.product.create({
    data: {
      tenantId: tenant.id, name: 'Tas Kanvas Laptop 14"', category: 'Aksesoris', status: 'ACTIVE',
      variants: { create: [{ sku: 'TAS-KNV-14', barcode: '8991000000020', name: 'Default', weight: 600 }] },
    },
    include: { variants: true },
  });

  const sneakers = await prisma.product.create({
    data: {
      tenantId: tenant.id, name: 'Sneakers Running', category: 'Sepatu', status: 'ACTIVE',
      variants: {
        create: [
          { sku: 'SNK-40', barcode: '8991000000030', name: 'Ukuran 40', weight: 700 },
          { sku: 'SNK-41', barcode: '8991000000031', name: 'Ukuran 41', weight: 700 },
          { sku: 'SNK-42', barcode: '8991000000032', name: 'Ukuran 42', weight: 700 },
        ],
      },
    },
    include: { variants: true },
  });

  const allVariants = [...kaos.variants, ...tumbler.variants, ...tas.variants, ...sneakers.variants];
  const bySku = (sku: string) => allVariants.find((v) => v.sku === sku)!;

  // 5. Inventory balances + opening movements (ledger)
  const stock: Array<[string, number]> = [
    ['KAOS-S', 50], ['KAOS-M', 40], ['KAOS-L', 30],
    ['TMB-500', 20], ['TAS-KNV-14', 15],
    ['SNK-40', 10], ['SNK-41', 12], ['SNK-42', 8],
  ];
  for (const [sku, qty] of stock) {
    const v = bySku(sku);
    await prisma.inventoryBalance.create({
      data: { warehouseId: warehouse.id, variantId: v.id, onHand: qty, reserved: 0, blocked: 0, version: 1 },
    });
    await prisma.inventoryMovement.create({
      data: {
        tenantId: tenant.id, warehouseId: warehouse.id, variantId: v.id,
        movementType: 'RECEIVE', quantityDelta: qty, referenceType: 'opening', reason: 'Saldo awal', actorId: owner.id,
      },
    });
  }

  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const in2h = new Date(now.getTime() + 2 * 3600 * 1000);
  const in6h = new Date(now.getTime() + 6 * 3600 * 1000);
  const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000);
  const yesterday = new Date(now.getTime() - 24 * 3600 * 1000);

  async function makeOrder(args: {
    externalOrderId: string; status: 'NEW' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';
    placedAt: Date; shipByAt: Date | null; buyer: string; phone: string;
    priorityLevel?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | null; priorityScore?: number | null;
    items: Array<{ sku: string; qty: number; price: number }>;
  }) {
    const order = await prisma.order.create({
      data: {
        tenantId: tenant.id, shopId: shop.id, externalOrderId: args.externalOrderId,
        status: args.status, placedAt: args.placedAt, shipByAt: args.shipByAt,
        buyerName: args.buyer, buyerPhone: args.phone,
        shippingAddress: { name: args.buyer, phone: args.phone, fullAddress: 'Jl. Contoh No. 1', city: 'Jakarta', state: 'DKI Jakarta', region: 'ID', zipcode: '10110' },
        priorityLevel: args.priorityLevel ?? null, priorityScore: args.priorityScore ?? null,
        priorityRuleVersion: 'priority-v1',
        items: {
          create: args.items.map((it) => ({
            variantId: bySku(it.sku).id, quantity: it.qty, fulfilledQuantity: 0, unitPrice: it.price, status: 'PENDING',
          })),
        },
      },
      include: { items: true },
    });
    await prisma.orderStatusHistory.create({
      data: { orderId: order.id, fromStatus: null, toStatus: args.status, reason: 'Pesanan diimpor dari marketplace' },
    });
    return order;
  }

  // Order A — CONFIRMED, high priority, ready to process
  const orderA = await makeOrder({
    externalOrderId: 'SHOPEE-240101-001', status: 'CONFIRMED', placedAt: yesterday, shipByAt: in2h,
    buyer: 'Budi Santoso', phone: '081234567890', priorityLevel: 'HIGH', priorityScore: 72,
    items: [{ sku: 'KAOS-M', qty: 2, price: 75000 }],
  });

  // Order B — CONFIRMED, medium priority
  const orderB = await makeOrder({
    externalOrderId: 'SHOPEE-240101-002', status: 'CONFIRMED', placedAt: yesterday, shipByAt: in6h,
    buyer: 'Siti Rahayu', phone: '087654321098', priorityLevel: 'MEDIUM', priorityScore: 55,
    items: [{ sku: 'TMB-500', qty: 1, price: 120000 }, { sku: 'TAS-KNV-14', qty: 1, price: 180000 }],
  });

  // Order C — NEW (not yet actionable)
  await makeOrder({
    externalOrderId: 'SHOPEE-240101-003', status: 'NEW', placedAt: now, shipByAt: tomorrow,
    buyer: 'Agus Wijaya', phone: '081299887766', priorityLevel: 'LOW', priorityScore: 20,
    items: [{ sku: 'SNK-42', qty: 1, price: 450000 }],
  });

  // Order D — completed yesterday (fulfilled via shipment below)
  const orderD = await makeOrder({
    externalOrderId: 'SHOPEE-231231-009', status: 'CONFIRMED', placedAt: new Date(yesterday.getTime() - 48 * 3600 * 1000), shipByAt: yesterday,
    buyer: 'Dewi Lestari', phone: '081399887766', priorityLevel: null, priorityScore: null,
    items: [{ sku: 'KAOS-S', qty: 1, price: 75000 }],
  });
  await prisma.orderStatusHistory.create({
    data: { orderId: orderD.id, fromStatus: 'CONFIRMED', toStatus: 'COMPLETED', actorId: staff.id, reason: 'Paket telah diterima pembeli', createdAt: yesterday },
  });
  await prisma.order.update({ where: { id: orderD.id }, data: { status: 'COMPLETED' } });
  await prisma.orderItem.updateMany({ where: { orderId: orderD.id }, data: { status: 'FULFILLED', fulfilledQuantity: 1 } });

  // Order E — CANCELLED
  await makeOrder({
    externalOrderId: 'SHOPEE-240101-004', status: 'CANCELLED', placedAt: yesterday, shipByAt: in6h,
    buyer: 'Eko Prasetyo', phone: '081277665544', priorityLevel: null, priorityScore: null,
    items: [{ sku: 'TMB-500', qty: 2, price: 120000 }],
  });

  async function reserve(orderItemId: string, sku: string, qty: number) {
    const v = bySku(sku);
    await prisma.stockReservation.create({
      data: { warehouseId: warehouse.id, variantId: v.id, orderItemId, quantity: qty, status: 'ACTIVE' },
    });
    await prisma.inventoryBalance.update({
      where: { warehouseId_variantId: { warehouseId: warehouse.id, variantId: v.id } },
      data: { reserved: { increment: qty }, version: { increment: 1 } },
    });
    await prisma.inventoryMovement.create({
      data: { tenantId: tenant.id, warehouseId: warehouse.id, variantId: v.id, movementType: 'RESERVE', quantityDelta: -qty, referenceType: 'order_item', referenceId: orderItemId, reason: 'Reservasi pesanan', actorId: staff.id },
    });
  }

  // 6. Fulfillment orders (pipeline)
  // Order A → READY_TO_PICK with picking task (stock reserved)
  const foA = await prisma.fulfillmentOrder.create({
    data: { orderId: orderA.id, warehouseId: warehouse.id, status: 'READY_TO_PICK' },
  });
  await reserve(orderA.items[0]!.id, 'KAOS-M', 2);
  await prisma.pickingTask.create({
    data: {
      fulfillmentOrderId: foA.id, status: 'PENDING',
      items: { create: [{ variantId: bySku('KAOS-M').id, expectedQuantity: 2, pickedQuantity: 0 }] },
    },
  });

  // Order B → PICKING with picking task (in progress)
  const foB = await prisma.fulfillmentOrder.create({
    data: { orderId: orderB.id, warehouseId: warehouse.id, status: 'PICKING', startedAt: new Date() },
  });
  await reserve(orderB.items[0]!.id, 'TMB-500', 1);
  await reserve(orderB.items[1]!.id, 'TAS-KNV-14', 1);
  await prisma.pickingTask.create({
    data: {
      fulfillmentOrderId: foB.id, status: 'IN_PROGRESS', assignedToId: staff.id, startedAt: new Date(),
      items: {
        create: [
          { variantId: bySku('TMB-500').id, expectedQuantity: 1, pickedQuantity: 1, isConfirmed: true, scannedAt: new Date() },
          { variantId: bySku('TAS-KNV-14').id, expectedQuantity: 1, pickedQuantity: 0 },
        ],
      },
    },
  });

  // 7. Shipment for the completed order
  await prisma.shipment.create({
    data: {
      orderId: orderD.id, awb: 'JNE00123456789', carrier: 'JNE', status: 'DELIVERED',
      shippedAt: yesterday, deliveredAt: new Date(yesterday.getTime() + 8 * 3600 * 1000),
      events: {
        create: [
          { status: 'PICKED_UP', description: 'Paket diambil kurir', occurredAt: yesterday },
          { status: 'DELIVERED', description: 'Paket diterima pembeli', occurredAt: new Date(yesterday.getTime() + 8 * 3600 * 1000) },
        ],
      },
    },
  });

  console.log('Seed selesai.');
  console.log('  Owner  : owner@toko.id / Owner12345');
  console.log('  Manager: manager@toko.id / Manager12345');
  console.log('  Staff  : staff@toko.id / Staff12345');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
