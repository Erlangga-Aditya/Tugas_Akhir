import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/shared/infrastructure/prisma';
import { importOrder } from '@/modules/orders/application/order.usecase';

/**
 * E2E NYATA (bukan mock): menjalankan alur Operator Harian lewat HTTP ke server dev
 * dengan database MySQL asli, memakai PRODUK SHOPEE ASLI hasil sinkronisasi.
 *
 * Cara menjalankan (server dev harus hidup):
 *   E2E_BASE_URL=http://localhost:3000 npx vitest run scripts
 *
 * Test ini MEMBERSIHKAN dirinya sendiri: semua order/lot/movement yang dibuat akan
 * dihapus dan saldo stok dikembalikan ke angka semula.
 */

const BASE = process.env.E2E_BASE_URL ?? '';
const VARIANT_ID = process.env.E2E_VARIANT_ID ?? 'cmub69ndf0005w75g9f89dwy9';
/** Gudang khusus uji — diisi di beforeAll supaya test tidak berebut stok dengan pesanan asli. */
let WAREHOUSE_ID = process.env.E2E_WAREHOUSE_ID ?? '';
const EMAIL = process.env.E2E_EMAIL ?? 'owner@toko.id';
const PASSWORD = process.env.E2E_PASSWORD ?? 'Owner12345';

type Json = Record<string, unknown>;

describe.skipIf(!BASE)('E2E Operasi Harian — stok FIFO dengan produk Shopee asli', () => {
  let cookie = '';
  let tenantId = '';
  let shopId = '';
  const createdOrderIds: string[] = [];
  const before = { onHand: 0, reserved: 0, variantExists: false };
  let testStart = new Date();

  async function call<T = Json>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { cookie } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as { data?: T; error?: { message?: string } };
    if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${json.error?.message ?? 'unknown'}`);
    return json.data as T;
  }

  beforeAll(async () => {
    testStart = new Date();

    const variant = await prisma.productVariant.findUnique({
      where: { id: VARIANT_ID },
      include: { product: { select: { tenantId: true } } },
    });
    if (!variant) throw new Error(`Variant E2E ${VARIANT_ID} tidak ada di DB`);
    tenantId = variant.product.tenantId;
    before.variantExists = true;

    // Gudang khusus uji (kode E2E-WH-01) — dibuat sekali lewat menu Pengaturan
    // supaya stok uji tidak berebut dengan pesanan asli yang sedang menunggu stok.
    if (!WAREHOUSE_ID) {
      const e2eWarehouse = await prisma.warehouse.findFirst({
        where: { tenantId, code: 'E2E-WH-01' },
        select: { id: true },
      });
      if (!e2eWarehouse) {
        throw new Error(
          'Gudang uji E2E-WH-01 belum ada. Buat sekali di menu Pengaturan dengan nama "Gudang Uji E2E".',
        );
      }
      WAREHOUSE_ID = e2eWarehouse.id;
    }

    const mapping = await prisma.externalProductMapping.findFirst({
      where: { variantId: VARIANT_ID },
      select: { shopId: true },
    });
    shopId = mapping?.shopId ?? '';

    const balance = await prisma.inventoryBalance.findUnique({
      where: { warehouseId_variantId: { warehouseId: WAREHOUSE_ID, variantId: VARIANT_ID } },
    });
    before.onHand = balance?.onHand ?? 0;
    before.reserved = balance?.reserved ?? 0;

    const login = await fetch(`${BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    const setCookie = login.headers.get('set-cookie') ?? '';
    cookie = (setCookie.split(';')[0] ?? '').trim();
    expect(login.status, 'login harus berhasil').toBe(200);
    expect(cookie).toContain('efh_session=');
  }, 60_000);

  afterAll(async () => {
    if (!E2E_BASE_URL_HAS_RUN) return;
    // Bersihkan semua yang dibuat test ini.
    if (createdOrderIds.length > 0) {
      const fos = await prisma.fulfillmentOrder.findMany({
        where: { orderId: { in: createdOrderIds } },
        select: { id: true },
      });
      const foIds = fos.map((f) => f.id);
      await prisma.shipment.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.packingTask.deleteMany({ where: { fulfillmentOrderId: { in: foIds } } });
      const tasks = await prisma.pickingTask.findMany({
        where: { fulfillmentOrderId: { in: foIds } },
        select: { id: true },
      });
      await prisma.pickingItem.deleteMany({ where: { pickingTaskId: { in: tasks.map((t) => t.id) } } });
      await prisma.pickingTask.deleteMany({ where: { fulfillmentOrderId: { in: foIds } } });
      await prisma.stockReservation.deleteMany({
        where: { orderItem: { orderId: { in: createdOrderIds } } },
      });
      await prisma.fulfillmentOrder.deleteMany({ where: { id: { in: foIds } } });
      await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
    // Ledger + lot yang dibuat test + kembalikan saldo stok seperti semula.
    await prisma.inventoryMovement.deleteMany({
      where: {
        warehouseId: WAREHOUSE_ID,
        variantId: VARIANT_ID,
        createdAt: { gte: testStart },
      },
    });
    await prisma.stockLot.deleteMany({
      where: { warehouseId: WAREHOUSE_ID, variantId: VARIANT_ID, createdAt: { gte: testStart } },
    });
    await prisma.inventoryBalance.upsert({
      where: { warehouseId_variantId: { warehouseId: WAREHOUSE_ID, variantId: VARIANT_ID } },
      update: { onHand: before.onHand, reserved: before.reserved },
      create: { warehouseId: WAREHOUSE_ID, variantId: VARIANT_ID, onHand: before.onHand, reserved: before.reserved },
    });
  }, 60_000);

  let E2E_BASE_URL_HAS_RUN = false;

  /**
   * Nomor resi untuk fixture uji.
   *
   * PENTING: resi TIDAK boleh dikarang oleh aplikasi. Test E2E memakai fixture
   * eksplisit yang ditulis langsung ke DB (bukan hasil panggilan Shopee),
   * karena order `E2E-*` memang tidak ada di Shopee sama sekali. Dengan begitu
   * gerbang AWB, FIFO, dan handover tetap diuji dengan data nyata di DB,
   * sementara jalur "Shopee menolak → dilaporkan jujur" diuji terpisah di test 7.
   */
  async function ambilNomorResi(orderId: string, label: string): Promise<string> {
    const awb = `E2E-AWB-${label}-${Date.now()}`;
    const shipment = await prisma.shipment.findFirst({ where: { orderId } });
    if (shipment) {
      await prisma.shipment.update({
        where: { id: shipment.id },
        data: { awb, carrier: 'E2E Express', status: 'READY_TO_SHIP' },
      });
    } else {
      await prisma.shipment.create({
        data: { orderId, awb, carrier: 'E2E Express', status: 'READY_TO_SHIP' },
      });
    }
    return awb;
  }

  it('1. daftar produk tambah-stok hanya berisi produk Shopee ASLI (hasil sinkronisasi)', async () => {
    const res = await call<{ items: Array<{ variantId: string; sku: string; shopName: string | null }> }>(
      '/api/v1/inventory/stock-in/options',
    );
    expect(res.items.length).toBeGreaterThan(0);
    expect(res.items.every((i) => i.shopName !== null)).toBe(true);
    expect(res.items.some((i) => i.variantId === VARIANT_ID)).toBe(true);
    E2E_BASE_URL_HAS_RUN = true;


  });

  it('2. stok masuk dicatat sebagai LOT (FIFO) dan menambah stok gudang', async () => {
    const qty1 = 5;
    const res1 = await call<{ message: string }>('/api/v1/inventory/stock-in', {
      method: 'POST',
      body: { warehouseId: WAREHOUSE_ID, variantId: VARIANT_ID, quantity: qty1, notes: 'E2E batch lama' },
    });
    expect(res1.message).toMatch(/Stok bertambah 5 unit/);

    const balanceAfter = await prisma.inventoryBalance.findUniqueOrThrow({
      where: { warehouseId_variantId: { warehouseId: WAREHOUSE_ID, variantId: VARIANT_ID } },
    });
    expect(balanceAfter.onHand).toBe(before.onHand + qty1);

    const lots = await prisma.stockLot.findMany({
      where: { warehouseId: WAREHOUSE_ID, variantId: VARIANT_ID, source: 'RECEIVE' },
      orderBy: { receivedAt: 'asc' },
    });
    expect(lots).toHaveLength(1);
    expect(lots[0]!.remaining).toBe(qty1);

    // Batch kedua (lebih baru) → akan keluar SETELAH batch pertama habis.
    await new Promise((r) => setTimeout(r, 1100));
    await call('/api/v1/inventory/stock-in', {
      method: 'POST',
      body: { warehouseId: WAREHOUSE_ID, variantId: VARIANT_ID, quantity: 3, notes: 'E2E batch baru' },
    });
    const lotsAfter = await prisma.stockLot.findMany({
      where: { warehouseId: WAREHOUSE_ID, variantId: VARIANT_ID, source: 'RECEIVE' },
      orderBy: { receivedAt: 'asc' },
    });
    expect(lotsAfter).toHaveLength(2);
    expect(lotsAfter.map((l) => l.remaining)).toEqual([5, 3]);
  }, 60_000);

  it('3. scan resi memotong stok FIFO: batch terlama dikonsumsi lebih dulu', async () => {
    const orderSn = `E2E-${Date.now()}-FIFO`;
    const imported = await importOrder(tenantId, {
      shopId,
      externalOrderId: orderSn,
      placedAt: new Date(),
      shipByAt: new Date(Date.now() + 6 * 3600 * 1000),
      buyerName: 'E2E Buyer FIFO',
      buyerPhone: '0800000000',
      shippingAddress: { fullAddress: 'E2E Test Address' },
      status: 'CONFIRMED',
      items: [{ variantId: VARIANT_ID, quantity: 4, unitPrice: 1000 }],
    });
    createdOrderIds.push(imported.orderId);

    await call('/api/v1/orders/' + imported.orderId + '/reserve', {
      method: 'POST',
      body: { warehouseId: WAREHOUSE_ID },
    });

    // Resi harus sudah ada di paket sebelum packing boleh terjadi (gerbang AWB).
    // Fixture ditulis langsung ke DB karena order E2E tidak ada di Shopee.
    const awb3 = await ambilNomorResi(imported.orderId, 'FIFO');

    const lotsBefore = await prisma.stockLot.findMany({
      where: { warehouseId: WAREHOUSE_ID, variantId: VARIANT_ID, remaining: { gt: 0 } },
      orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }],
    });

    const scan = await call<{
      code: string;
      stockDeducted: boolean;
      deductedUnits: number;
      message: string;
    }>('/api/v1/fulfillment/scan-awb', {
      method: 'POST',
      body: { scannedCode: awb3, confirmPicking: true },
    });

    expect(scan.code).toBe('PACKED');
    expect(scan.stockDeducted).toBe(true);
    expect(scan.deductedUnits).toBe(4);

    const lotsAfter = await prisma.stockLot.findMany({
      where: { warehouseId: WAREHOUSE_ID, variantId: VARIANT_ID, source: 'RECEIVE' },
      orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }],
    });
    // FIFO: batch lama (5) tersisa 1, batch baru (3) belum tersentuh.
    expect(lotsAfter.map((l) => l.remaining)).toEqual([1, 3]);

    const deduction = await prisma.inventoryMovement.findFirst({
      where: {
        warehouseId: WAREHOUSE_ID,
        variantId: VARIANT_ID,
        movementType: 'DEDUCTION',
        referenceId: imported.orderId,
      },
    });
    expect(deduction?.quantityDelta).toBe(-4);
    expect(deduction?.stockLotId).toBe(lotsBefore[0]!.id);

    const fo = await prisma.fulfillmentOrder.findFirstOrThrow({
      where: { orderId: imported.orderId },
      select: { id: true, status: true },
    });
    expect(fo.status).toBe('PACKED');
  }, 60_000);

  it('4. JUJUR: stok kurang TIDAK memotong stok dan tidak mengaku sukses', async () => {
    const orderSn = `E2E-${Date.now()}-KURANG`;
    const imported = await importOrder(tenantId, {
      shopId,
      externalOrderId: orderSn,
      placedAt: new Date(),
      shipByAt: new Date(Date.now() + 6 * 3600 * 1000),
      buyerName: 'E2E Buyer Kurang',
      buyerPhone: '0800000001',
      shippingAddress: { fullAddress: 'E2E Test Address 2' },
      status: 'CONFIRMED',
      items: [{ variantId: VARIANT_ID, quantity: 999, unitPrice: 1000 }],
    });
    createdOrderIds.push(imported.orderId);

    await call('/api/v1/orders/' + imported.orderId + '/reserve', {
      method: 'POST',
      body: { warehouseId: WAREHOUSE_ID },
    });
    const awb4 = await ambilNomorResi(imported.orderId, 'KURANG');

    const movementsBefore = await prisma.inventoryMovement.count({
      where: { warehouseId: WAREHOUSE_ID, variantId: VARIANT_ID, movementType: 'DEDUCTION' },
    });
    const balanceBefore = await prisma.inventoryBalance.findUniqueOrThrow({
      where: { warehouseId_variantId: { warehouseId: WAREHOUSE_ID, variantId: VARIANT_ID } },
    });

    const scan = await call<{
      code: string;
      stockDeducted: boolean;
      needsConfirmation: string | null;
      shortfalls: Array<{ missing: number }>;
    }>('/api/v1/fulfillment/scan-awb', {
      method: 'POST',
      body: { scannedCode: awb4, confirmPicking: true },
    });

    expect(scan.code).toBe('WAITING_STOCK');
    expect(scan.stockDeducted).toBe(false);
    expect(scan.needsConfirmation).toBe('NEGATIVE_STOCK');
    expect(scan.shortfalls[0]!.missing).toBeGreaterThan(0);

    const movementsAfter = await prisma.inventoryMovement.count({
      where: { warehouseId: WAREHOUSE_ID, variantId: VARIANT_ID, movementType: 'DEDUCTION' },
    });
    const balanceAfter = await prisma.inventoryBalance.findUniqueOrThrow({
      where: { warehouseId_variantId: { warehouseId: WAREHOUSE_ID, variantId: VARIANT_ID } },
    });
    expect(movementsAfter, 'tidak boleh ada pemotongan stok').toBe(movementsBefore);
    expect(balanceAfter.onHand, 'stok tidak boleh berubah').toBe(balanceBefore.onHand);
  }, 60_000);

  it('5. serah terima kurir TIDAK memotong stok dua kali', async () => {
    const orderSn = `E2E-${Date.now()}-HANDOVER`;
    const imported = await importOrder(tenantId, {
      shopId,
      externalOrderId: orderSn,
      placedAt: new Date(),
      shipByAt: new Date(Date.now() + 6 * 3600 * 1000),
      buyerName: 'E2E Buyer Handover',
      buyerPhone: '0800000002',
      shippingAddress: { fullAddress: 'E2E Test Address 3' },
      status: 'CONFIRMED',
      items: [{ variantId: VARIANT_ID, quantity: 2, unitPrice: 1000 }],
    });
    createdOrderIds.push(imported.orderId);
    await call('/api/v1/orders/' + imported.orderId + '/reserve', {
      method: 'POST',
      body: { warehouseId: WAREHOUSE_ID },
    });

    const awb5 = await ambilNomorResi(imported.orderId, 'HANDOVER');
    const scan = await call<{ code: string }>('/api/v1/fulfillment/scan-awb', {
      method: 'POST',
      body: { scannedCode: awb5, confirmPicking: true },
    });
    expect(scan.code).toBe('PACKED');

    const fo = await prisma.fulfillmentOrder.findFirstOrThrow({ where: { orderId: imported.orderId } });
    const deductionAfterPacking = await prisma.inventoryMovement.count({
      where: { warehouseId: WAREHOUSE_ID, variantId: VARIANT_ID, movementType: 'DEDUCTION' },
    });

    // UI satu halaman menampilkan PACKED sebagai "Siap Kirim" dan operator
    // boleh langsung menekan "Serahkan ke Kurir". Backend harus aman, meskipun
    // operator tidak memanggil route ready-to-ship secara terpisah.
    const shipment = await prisma.shipment.findFirstOrThrow({ where: { orderId: imported.orderId } });
    // Fixture E2E memakai status `READY_TO_SHIP` (paket belum diserahkan kurir).
    expect(['READY_TO_SHIP', 'PICKED_UP']).toContain(shipment.status);
    await call(`/api/v1/fulfillment/orders/${fo.id}/handover`, {
      method: 'POST',
      body: { carrier: shipment.carrier ?? 'SPX Express', awb: awb5 },
    });

    const deductionAfterHandover = await prisma.inventoryMovement.count({
      where: { warehouseId: WAREHOUSE_ID, variantId: VARIANT_ID, movementType: 'DEDUCTION' },
    });
    expect(deductionAfterHandover, 'handover tidak boleh menambah potongan stok').toBe(deductionAfterPacking);

    const finalized = await prisma.fulfillmentOrder.findUniqueOrThrow({ where: { id: fo.id } });
    expect(finalized.status).toBe('HANDED_OVER');
  }, 60_000);

  it('6. scan ulang pesanan yang sudah dipacking tidak memotong stok lagi', async () => {
    const first = createdOrderIds[createdOrderIds.length - 1]!;
    const order = await prisma.order.findUniqueOrThrow({ where: { id: first } });
    const movementsBefore = await prisma.inventoryMovement.count({
      where: { warehouseId: WAREHOUSE_ID, variantId: VARIANT_ID, movementType: 'DEDUCTION' },
    });

    const shipment = await prisma.shipment.findFirstOrThrow({ where: { orderId: order.id } });
    expect(shipment.awb).toBeTruthy();
    const scan = await call<{ code: string; stockDeducted: boolean }>('/api/v1/fulfillment/scan-awb', {
      method: 'POST',
      body: { scannedCode: shipment.awb! },
    });
    expect(['ALREADY_HANDED_OVER', 'ALREADY_PACKED']).toContain(scan.code);

    const movementsAfter = await prisma.inventoryMovement.count({
      where: { warehouseId: WAREHOUSE_ID, variantId: VARIANT_ID, movementType: 'DEDUCTION' },
    });
    expect(movementsAfter).toBe(movementsBefore);
  }, 60_000);

  it('6b. GERBANG RESI: nomor pesanan tidak boleh dipakai untuk menyelesaikan packing', async () => {
    const orderSn = `E2E-${Date.now()}-TANPARESI`;
    const imported = await importOrder(tenantId, {
      shopId,
      externalOrderId: orderSn,
      placedAt: new Date(),
      shipByAt: new Date(Date.now() + 6 * 3600 * 1000),
      buyerName: 'E2E Buyer Tanpa Resi',
      buyerPhone: '0800000009',
      shippingAddress: { fullAddress: 'E2E Test Address Tanpa Resi' },
      status: 'CONFIRMED',
      items: [{ variantId: VARIANT_ID, quantity: 1, unitPrice: 1000 }],
    });
    createdOrderIds.push(imported.orderId);

    await call('/api/v1/orders/' + imported.orderId + '/reserve', {
      method: 'POST',
      body: { warehouseId: WAREHOUSE_ID },
    });

    const movementsBefore = await prisma.inventoryMovement.count({
      where: { warehouseId: WAREHOUSE_ID, variantId: VARIANT_ID, movementType: 'DEDUCTION' },
    });

    const scan = await call<{ code: string; stockDeducted: boolean; message: string }>(
      '/api/v1/fulfillment/scan-awb',
      { method: 'POST', body: { scannedCode: orderSn, confirmPicking: true } },
    );

    // Nomor pesanan boleh DITEMUKAN (lookup konteks) tapi TIDAK boleh menyelesaikan
    // packing: pesanan ini belum punya nomor resi, jadi jawabannya NEEDS_SHIPMENT
    // dan stok tidak boleh tersentuh.
    expect(scan.code, 'nomor pesanan bukan hasil scan resi yang sah').toBe('NEEDS_SHIPMENT');
    expect(scan.stockDeducted).toBe(false);
    expect(scan.message.toLowerCase()).toContain('belum punya pengiriman');

    const movementsAfter = await prisma.inventoryMovement.count({
      where: { warehouseId: WAREHOUSE_ID, variantId: VARIANT_ID, movementType: 'DEDUCTION' },
    });
    expect(movementsAfter, 'stok tidak boleh dipotong tanpa scan resi').toBe(movementsBefore);

    const fo = await prisma.fulfillmentOrder.findFirstOrThrow({ where: { orderId: imported.orderId } });
    expect(fo.status).not.toBe('PACKED');
  }, 60_000);

  it('7. "Ambil Resi dari Shopee" (satu klik): pesanan masuk antrian, dan kegagalan resi dilaporkan jujur', async () => {
    const orderSn = `E2E-${Date.now()}-RESI`;
    const imported = await importOrder(tenantId, {
      shopId,
      externalOrderId: orderSn,
      placedAt: new Date(),
      shipByAt: new Date(Date.now() + 6 * 3600 * 1000),
      buyerName: 'E2E Buyer Resi',
      buyerPhone: '0800000003',
      shippingAddress: { fullAddress: 'E2E Test Address 4' },
      status: 'CONFIRMED',
      items: [{ variantId: VARIANT_ID, quantity: 1, unitPrice: 1000 }],
    });
    createdOrderIds.push(imported.orderId);

    const res = await call<{
      success: boolean;
      trackingNumber: string | null;
      simulated: boolean;
      stockReady: boolean;
      message: string;
    }>(`/api/v1/orders/${imported.orderId}/prepare-shipment`, { method: 'POST', body: {} });

    // Pesanan harus masuk antrian kerja (dengan atau tanpa stok cukup).
    const fo = await prisma.fulfillmentOrder.findFirst({ where: { orderId: imported.orderId } });
    expect(fo, 'pesanan harus punya antrian kerja setelah Ambil Resi').not.toBeNull();

    // Order E2E tidak ada di Shopee, jadi wajib gagal — dan wajib JUJUR:
    // tidak boleh ada nomor resi karangan yang tersimpan di database.
    expect(res.success, 'order E2E tidak mungkin mendapat resi asli dari Shopee').toBe(false);
    expect(res.simulated, 'resi simulasi sudah dihapus dari aplikasi').toBe(false);
    expect(res.message.length).toBeGreaterThan(5);
    expect(res.message.toLowerCase()).toContain('resi');

    const shipment = await prisma.shipment.findFirst({ where: { orderId: imported.orderId } });
    expect(shipment?.awb ?? null, 'tidak boleh ada nomor resi karangan tersimpan').toBeNull();
  }, 60_000);

  it('8. daftar kerja mengembalikan tahapan & urutan yang bisa dipilih', async () => {
    const oldest = await call<{ sort: string; orders: Array<{ orderId: string }>; stages: Record<string, number> }>(
      '/api/v1/fulfillment/station?sort=oldest',
    );
    const newest = await call<{ sort: string; orders: Array<{ orderId: string }> }>(
      '/api/v1/fulfillment/station?sort=newest',
    );
    expect(oldest.sort).toBe('oldest');
    expect(newest.sort).toBe('newest');
    expect(typeof oldest.stages.baru).toBe('number');
    if (oldest.orders.length > 1) {
      expect(newest.orders[0]!.orderId).not.toBe(oldest.orders[0]!.orderId);
    }
  }, 60_000);
  it('9. laporan keuangan & rincian biaya: angka berasal dari data Shopee, bukan nol karangan', async () => {
    const report = await call<{
      totals: {
        orderCount: number;
        ordersWithDetail: number;
        buyerPaid: number;
        grossSales: number;
        estimatedPayout: number;
      };
      orders: Array<{ externalOrderId: string; hasMoneyDetail: boolean }>;
    }>('/api/v1/reports/finance');

    expect(typeof report.totals.orderCount).toBe('number');
    expect(report.totals.orderCount).toBeGreaterThan(0);
    // Pesanan kita (yang dibuat test ini) harus ikut terhitung.
    const ours = report.orders.find((o) => o.externalOrderId.includes('E2E-'));
    expect(ours, 'pesanan uji harus muncul di laporan keuangan').toBeDefined();
    // Angka tidak boleh negatif, dan tidak boleh dihitung sebagai "ada rincian" tanpa data.
    expect(report.totals.buyerPaid).toBeGreaterThanOrEqual(0);
    expect(report.totals.grossSales).toBeGreaterThanOrEqual(0);
    expect(report.totals.ordersWithDetail).toBeLessThanOrEqual(report.totals.orderCount);
  }, 60_000);

  it('10. tarik rincian biaya dari Shopee melaporkan keadaan sebenarnya', async () => {
    const res = await call<{ requested: number; updated: number; message: string }>(
      '/api/v1/integrations/shopee/sync-escrow',
      { method: 'POST', body: { limit: 5 } },
    );
    expect(typeof res.requested).toBe('number');
    expect(typeof res.updated).toBe('number');
    expect(res.updated).toBeLessThanOrEqual(res.requested);
    expect(res.message.length).toBeGreaterThan(5);
    // Kalau tidak ada yang bisa diperbarui, alasannya harus dijelaskan (tidak diam-diam).
    if (res.updated === 0 && res.requested > 0) {
      expect(res.message.toLowerCase()).toMatch(/belum|selesai|rincian/);
    }
  }, 60_000);
});
