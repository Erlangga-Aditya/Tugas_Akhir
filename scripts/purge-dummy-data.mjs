/**
 * Bersihkan data contoh/uji dari database — aman untuk database produksi.
 *
 * Yang dibersihkan HANYA data yang jelas berasal dari seed pengembangan atau
 * skrip uji otomatis:
 *
 *   1. Akun uji  : email `staff.uji.*@toko.id`, `staff@toko.id`,
 *                  `manager@toko.id`, atau nama "Staff Uji Otomatis".
 *   2. Produk contoh dari `prisma/seed.ts` (Kaos Polos Premium, Tumbler
 *      Stainless 500ml, Tas Kanvas Laptop 14", Sneakers Running) — hanya bila
 *      produk itu TIDAK punya pemetaan produk Shopee dan tidak dipakai pesanan.
 *   3. Pesanan contoh (`SHOPEE-…`) dan pesanan E2E (`E2E-…`) beserta seluruh
 *      turunannya (item, fulfillment, picking, shipment, reservasi, ledger).
 *   4. Tenant duplikat yang benar-benar kosong (tanpa toko, pesanan, produk,
 *      dan stok), beserta gudangnya — dengan catatan: pemiliknya DIPINDAHKAN
 *      ke tenant utama lebih dulu supaya akunnya tidak kehilangan akses.
 *
 * Data nyata TIDAK disentuh: pesanan Shopee, produk hasil sinkronisasi, stok,
 * audit log, dan akun bernama asli. Jejak audit dipertahankan — kolom
 * `actor_id` dikosongkan (NULL), bukan barisnya dihapus.
 *
 * Jalankan (dari folder aplikasi, di server):
 *   node scripts/purge-dummy-data.mjs            # hanya melapor, tidak mengubah
 *   node scripts/purge-dummy-data.mjs --apply    # benar-benar menghapus
 *   node scripts/purge-dummy-data.mjs --apply --primary-tenant=toko-utama
 *
 * Idempoten: menjalankan ulang tidak menemukan apa pun lagi.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const primaryArg = process.argv.find((a) => a.startsWith('--primary-tenant='));
const PRIMARY_SLUG = primaryArg ? primaryArg.split('=')[1] : 'toko-utama';

const TEST_EMAILS = ['staff@toko.id', 'manager@toko.id'];
const TEST_EMAIL_PREFIX = 'staff.uji.';
const TEST_USER_NAME = 'Staff Uji Otomatis';
const SEED_PRODUCTS = [
  'Kaos Polos Premium',
  'Tumbler Stainless 500ml',
  'Tas Kanvas Laptop 14"',
  'Sneakers Running',
];
const DUMMY_ORDER_PREFIXES = ['SHOPEE-', 'E2E-'];

const log = (...args) => console.log(...args);
const head = (title) => log(`\n=== ${title} ===`);

/** Jalankan perubahan hanya kalau `--apply`; selain itu cukup melapor. */
async function write(label, fn, preview) {
  if (!APPLY) {
    log(`  [rencana] ${label}${preview ? ` — ${preview}` : ''}`);
    return 0;
  }
  const count = await fn();
  log(`  [hapus]   ${label}${count !== undefined ? ` → ${count} baris` : ''}`);
  return count ?? 0;
}

async function findTestUsers() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, status: true },
  });
  return users.filter(
    (u) =>
      TEST_EMAILS.includes(u.email.toLowerCase()) ||
      u.email.toLowerCase().startsWith(TEST_EMAIL_PREFIX) ||
      u.name === TEST_USER_NAME,
  );
}

async function findSeedProducts() {
  const products = await prisma.product.findMany({
    where: { name: { in: SEED_PRODUCTS } },
    select: {
      id: true,
      name: true,
      tenantId: true,
      variants: {
        select: {
          id: true,
          externalMappings: { select: { id: true } },
          orderItems: { select: { id: true }, take: 1 },
        },
      },
    },
  });
  // Hanya produk yang benar-benar contoh: tidak berasal dari Shopee dan tidak
  // pernah dipakai pesanan nyata.
  return products.filter((p) =>
    p.variants.every((v) => v.externalMappings.length === 0 && v.orderItems.length === 0),
  );
}

async function findDummyOrders() {
  return prisma.order.findMany({
    where: { OR: DUMMY_ORDER_PREFIXES.map((p) => ({ externalOrderId: { startsWith: p } })) },
    select: { id: true, externalOrderId: true, tenantId: true },
  });
}

/** Tenant yang tidak punya isi apa pun — kandidat duplikat dari pendaftaran ganda. */
async function findEmptyTenants(primaryId) {
  const tenants = await prisma.tenant.findMany({
    select: { id: true, name: true, slug: true },
  });
  const kosong = [];
  for (const t of tenants) {
    if (t.id === primaryId) continue;
    const [shops, orders, products, warehouses, memberships] = await Promise.all([
      prisma.shop.count({ where: { tenantId: t.id } }),
      prisma.order.count({ where: { tenantId: t.id } }),
      prisma.product.count({ where: { tenantId: t.id } }),
      prisma.warehouse.findMany({
        where: { tenantId: t.id },
        select: { id: true, name: true },
      }),
      prisma.tenantMembership.findMany({
        where: { tenantId: t.id },
        select: { id: true, userId: true, role: true, permissions: true },
      }),
    ]);
    // `warehouses` berisi baris (bukan jumlah) karena gudangnya ikut dihapus.
    if (shops === 0 && orders === 0 && products === 0) {
      kosong.push({ ...t, warehouses, memberships });
    }
  }
  return kosong;
}

async function deleteOrders(orders) {
  let removed = 0;
  for (const order of orders) {
    await prisma.$transaction(async (tx) => {
      const fos = await tx.fulfillmentOrder.findMany({
        where: { orderId: order.id },
        select: { id: true },
      });
      const foIds = fos.map((f) => f.id);
      if (foIds.length > 0) {
        // PickingItem ikut terhapus lewat cascade dari PickingTask.
        await tx.pickingTask.deleteMany({ where: { fulfillmentOrderId: { in: foIds } } });
        await tx.packingTask.deleteMany({ where: { fulfillmentOrderId: { in: foIds } } });
        await tx.fulfillmentOrder.deleteMany({ where: { id: { in: foIds } } });
      }
      const shipments = await tx.shipment.findMany({ where: { orderId: order.id }, select: { id: true } });
      const shipmentIds = shipments.map((s) => s.id);
      if (shipmentIds.length > 0) {
        await tx.shipmentEvent.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
        await tx.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
      }
      const itemIds = (
        await tx.orderItem.findMany({ where: { orderId: order.id }, select: { id: true } })
      ).map((i) => i.id);
      // Reservasi menempel pada baris pesanan (order_item), bukan pada pesanan.
      await tx.stockReservation.deleteMany({ where: { orderItemId: { in: itemIds } } });
      await tx.inventoryMovement.deleteMany({
        where: { referenceType: 'order_item', referenceId: { in: itemIds } },
      });
      await tx.orderStatusHistory.deleteMany({ where: { orderId: order.id } });
      await tx.orderItem.deleteMany({ where: { orderId: order.id } });
      await tx.order.delete({ where: { id: order.id } });
    });
    removed += 1;
  }
  return removed;
}

async function main() {
  log(APPLY ? 'MODE: HAPUS (--apply)' : 'MODE: PRATINJAU (tidak ada yang diubah)');

  const primary = await prisma.tenant.findUnique({ where: { slug: PRIMARY_SLUG } });
  if (!primary) throw new Error(`Tenant utama "${PRIMARY_SLUG}" tidak ditemukan.`);

  head('1. Akun uji');
  const testUsers = await findTestUsers();
  for (const u of testUsers) log(`  - ${u.email} (${u.name}, ${u.status})`);
  if (testUsers.length === 0) log('  (tidak ada)');
  for (const u of testUsers) {
    // Jejak audit dipertahankan: pelakunya dikosongkan, barisnya tidak dihapus.
    await write(
      `audit log milik ${u.email} → actor dikosongkan`,
      async () => (await prisma.auditLog.updateMany({ where: { actorId: u.id }, data: { actorId: null } })).count,
    );
    await write(
      `akun uji ${u.email}`,
      async () => {
        await prisma.tenantMembership.deleteMany({ where: { userId: u.id } });
        await prisma.pickingTask.updateMany({ where: { assignedToId: u.id }, data: { assignedToId: null } });
        return (await prisma.user.deleteMany({ where: { id: u.id } })).count;
      },
    );
  }

  head('2. Produk contoh');
  const seedProducts = await findSeedProducts();
  for (const p of seedProducts) log(`  - ${p.name} (${p.variants.length} varian)`);
  if (seedProducts.length === 0) log('  (tidak ada)');
  for (const p of seedProducts) {
    const variantIds = p.variants.map((v) => v.id);
    await write(`stok & ledger untuk ${p.name}`, async () => {
      await prisma.inventoryMovement.deleteMany({ where: { variantId: { in: variantIds } } });
      await prisma.inventoryBalance.deleteMany({ where: { variantId: { in: variantIds } } });
      await prisma.stockLot.deleteMany({ where: { variantId: { in: variantIds } } });
      return variantIds.length;
    });
    await write(`produk contoh ${p.name}`, async () => {
      await prisma.productVariant.deleteMany({ where: { id: { in: variantIds } } });
      return (await prisma.product.deleteMany({ where: { id: p.id } })).count;
    });
  }

  head('3. Pesanan contoh / uji');
  const dummyOrders = await findDummyOrders();
  for (const o of dummyOrders) log(`  - ${o.externalOrderId}`);
  if (dummyOrders.length === 0) log('  (tidak ada)');
  if (dummyOrders.length > 0) {
    await write(`${dummyOrders.length} pesanan contoh beserta turunannya`, () => deleteOrders(dummyOrders));
  }

  head('4. Tenant duplikat yang kosong');
  const emptyTenants = await findEmptyTenants(primary.id);
  if (emptyTenants.length === 0) {
    log('  (tidak ada)');
  } else {
    for (const t of emptyTenants) {
      log(`  - ${t.name} (${t.slug}) — ${t.memberships.length} anggota, ${t.warehouses.length} gudang`);
      for (const m of t.memberships) {
        const sudahAda = await prisma.tenantMembership.findUnique({
          where: { tenantId_userId: { tenantId: primary.id, userId: m.userId } },
          select: { id: true },
        });
        if (sudahAda) {
          log(`    · anggota ${m.userId} sudah punya akses ke ${PRIMARY_SLUG}; keanggotaan duplikat dihapus`);
          await write('keanggotaan duplikat', () =>
            prisma.tenantMembership.deleteMany({ where: { id: m.id } }).then((r) => r.count),
          );
        } else {
          // Pemilik workspace kosong dipindahkan, bukan dihapus: kalau tidak,
          // akun itu kehilangan seluruh akses dan tidak bisa login ke mana pun.
          log(`    · anggota ${m.userId} dipindahkan ke ${PRIMARY_SLUG} sebagai ${m.role}`);
          await write('pemindahan keanggotaan', () =>
            prisma.tenantMembership
              .create({
                data: {
                  tenantId: primary.id,
                  userId: m.userId,
                  role: m.role,
                  permissions: m.permissions ?? undefined,
                },
              })
              .then(() => 1),
          );
          await write('keanggotaan lama dihapus', () =>
            prisma.tenantMembership.deleteMany({ where: { id: m.id } }).then((r) => r.count),
          );
        }
      }
      for (const w of t.warehouses) {
        await write(`gudang "${w.name}" pada tenant ${t.slug}`, async () => {
          await prisma.inventoryBalance.deleteMany({ where: { warehouseId: w.id } });
          await prisma.inventoryMovement.deleteMany({ where: { warehouseId: w.id } });
          await prisma.stockLot.deleteMany({ where: { warehouseId: w.id } });
          return (await prisma.warehouse.deleteMany({ where: { id: w.id } })).count;
        });
      }
      // Audit log adalah satu-satunya baris yang masih menahan penghapusan
      // tenant (FK `audit_logs.tenant_id`). Jejaknya TIDAK dibuang: dipindahkan
      // ke tenant utama karena pelakunya orang yang sama, hanya workspace-nya
      // dobel. Setelah ini tidak ada lagi yang menghalangi.
      await write(`audit log tenant ${t.slug} → dipindahkan ke ${PRIMARY_SLUG}`, () =>
        prisma.auditLog
          .updateMany({ where: { tenantId: t.id }, data: { tenantId: primary.id } })
          .then((r) => r.count),
      );
      await write(`tenant kosong ${t.slug}`, () => prisma.tenant.deleteMany({ where: { id: t.id } }).then((r) => r.count));
    }
  }

  head('Ringkasan akhir');
  const [users, orders, products, tenants] = await Promise.all([
    prisma.user.count(),
    prisma.order.count(),
    prisma.product.count(),
    prisma.tenant.count(),
  ]);
  log(`  pengguna: ${users} · pesanan: ${orders} · produk: ${products} · tenant: ${tenants}`);
  if (!APPLY) log('\nTidak ada perubahan. Jalankan ulang dengan --apply untuk menghapus.');
  else log('\nSelesai.');
}

main()
  .catch((e) => {
    console.error('GAGAL:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
