/**
 * Purge dummy seed data dari database, mempertahankan:
 * - Tenant, Users, TenantMemberships, Warehouse WH-01, Aturan Prioritas
 * - Shop & IntegrationConnection (Shopee real)
 * - Produk REAL dari Shopee (yang punya ExternalProductMapping)
 * - Pesanan REAL dari Shopee (yang externalOrderId-nya tidak SHOPEE-2401*)
 * - SyncRun, WebhookEvent, AuditLog
 *
 * Yang DIHAPUS:
 * - Produk dummy seed (Kaos Polos Premium, Tumbler, Tas, Sneakers) tanpa ExternalProductMapping
 * - Pesanan dummy seed (SHOPEE-240101-*, SHOPEE-231231-009)
 * - Semua dependensi dummy (OrderItems, FulfillmentOrders, PickingTasks, Shipments, Reservations, InventoryBalances/Movements)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DUMMY_ORDER_IDS = [
  'SHOPEE-240101-001',
  'SHOPEE-240101-002',
  'SHOPEE-240101-003',
  'SHOPEE-231231-009',
  'SHOPEE-240101-004',
];

async function purgeDummyData() {
  console.log('🧹 Memulai pembersihan data dummy...\n');

  // ── 1. Ambil info produk dummy (tidak punya ExternalProductMapping) ──────
  const allProducts = await prisma.product.findMany({
    include: {
      variants: {
        include: {
          externalMappings: { select: { id: true } },
        },
      },
    },
  });

  // Produk dummy = semua variannya tidak punya externalMapping
  const dummyProducts = allProducts.filter((p) =>
    p.variants.every((v) => v.externalMappings.length === 0),
  );
  const dummyProductIds = dummyProducts.map((p) => p.id);
  const dummyVariantIds = dummyProducts.flatMap((p) => p.variants.map((v) => v.id));

  console.log(`📦 Produk dummy ditemukan: ${dummyProducts.length}`);
  for (const p of dummyProducts) {
    console.log(`   - ${p.name} (${p.variants.length} varian)`);
  }

  // ── 2. Ambil pesanan dummy ──────────────────────────────────────────────
  const dummyOrders = await prisma.order.findMany({
    where: { externalOrderId: { in: DUMMY_ORDER_IDS } },
    include: {
      items: { include: { reservations: true } },
      fulfillmentOrders: {
        include: {
          pickingTasks: { include: { items: true } },
          packingTasks: true,
        },
      },
      shipments: { include: { events: true } },
      statusHistory: true,
      returns: { include: { items: true } },
    },
  });

  console.log(`\n📋 Pesanan dummy ditemukan: ${dummyOrders.length}`);
  for (const o of dummyOrders) {
    console.log(`   - ${o.externalOrderId} (${o.status})`);
  }

  // ── Hapus dalam urutan aman (leaf → parent) ─────────────────────────────
  console.log('\n⬇️  Menghapus data dummy...');

  for (const order of dummyOrders) {
    // Shipment events & shipments
    for (const ship of order.shipments) {
      await prisma.shipmentEvent.deleteMany({ where: { shipmentId: ship.id } });
    }
    await prisma.shipment.deleteMany({ where: { orderId: order.id } });

    // Return items & returns
    for (const ret of order.returns) {
      await prisma.returnItem.deleteMany({ where: { returnId: ret.id } });
    }
    await prisma.return.deleteMany({ where: { orderId: order.id } });

    // Picking items, picking tasks, packing tasks, fulfillment orders
    for (const fo of order.fulfillmentOrders) {
      for (const pt of fo.pickingTasks) {
        await prisma.pickingItem.deleteMany({ where: { pickingTaskId: pt.id } });
      }
      await prisma.pickingTask.deleteMany({ where: { fulfillmentOrderId: fo.id } });
      await prisma.packingTask.deleteMany({ where: { fulfillmentOrderId: fo.id } });
    }
    await prisma.fulfillmentOrder.deleteMany({ where: { orderId: order.id } });

    // Stock reservations
    for (const item of order.items) {
      await prisma.stockReservation.deleteMany({ where: { orderItemId: item.id } });
    }

    // Order items, status history
    await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: order.id } });
    await prisma.order.delete({ where: { id: order.id } });
    console.log(`   ✅ Order ${order.externalOrderId} dihapus`);
  }

  // ── Hapus inventory balances & movements untuk varian dummy ─────────────
  if (dummyVariantIds.length > 0) {
    const delBal = await prisma.inventoryBalance.deleteMany({
      where: { variantId: { in: dummyVariantIds } },
    });
    const delMov = await prisma.inventoryMovement.deleteMany({
      where: { variantId: { in: dummyVariantIds } },
    });
    console.log(`   ✅ InventoryBalances dihapus: ${delBal.count}`);
    console.log(`   ✅ InventoryMovements dihapus: ${delMov.count}`);
  }

  // ── Hapus varian dan produk dummy ────────────────────────────────────────
  if (dummyVariantIds.length > 0) {
    // Harus hapus OrderItems yang mungkin masih referensi varian ini (tapi sudah tidak ada)
    await prisma.productVariant.deleteMany({ where: { id: { in: dummyVariantIds } } });
    console.log(`   ✅ ProductVariants dummy dihapus: ${dummyVariantIds.length}`);
  }

  if (dummyProductIds.length > 0) {
    await prisma.product.deleteMany({ where: { id: { in: dummyProductIds } } });
    console.log(`   ✅ Products dummy dihapus: ${dummyProductIds.length}`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n✅ Pembersihan selesai!\n');

  const remaining = await prisma.product.findMany({
    select: { id: true, name: true, variants: { select: { sku: true } } },
  });
  const remainingOrders = await prisma.order.count();
  console.log(`📊 Sisa di database:`);
  console.log(`   - Produk: ${remaining.length} (${remaining.map((p) => p.name).join(', ')})`);
  console.log(`   - Pesanan: ${remainingOrders}`);
}

purgeDummyData()
  .catch((e) => {
    console.error('❌ Error saat purge:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
