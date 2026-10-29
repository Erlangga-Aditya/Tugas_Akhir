#!/usr/bin/env bash
# Diagnosa stok READ-ONLY untuk satu pesanan (kenapa "stok gudang belum cukup").
set -u
cd /opt/efulfill/app || exit 1
set -a; . ./.env; set +a
cat > /tmp/diag-stok.js <<'JS'
const { PrismaClient } = require('/opt/efulfill/app/node_modules/@prisma/client');
const p = new PrismaClient();
const ORDER_SN = process.env.ORDER_SN || '261027QHEBBY8Q';
const num = v => typeof v === 'bigint' ? Number(v) : v;

(async () => {
  const order = await p.order.findFirst({
    where: { externalOrderId: ORDER_SN },
    select: {
      id: true, status: true, externalStatus: true,
      items: { select: { id: true, quantity: true, fulfilledQuantity: true, variantId: true,
        variant: { select: { sku: true, name: true } } } },
      fulfillmentOrders: { select: { id: true, status: true, warehouseId: true } },
    },
  });
  if (!order) { console.log('pesanan tidak ada'); return; }
  console.log('pesanan:', ORDER_SN, '|', order.status, '/', order.externalStatus);
  console.log('fulfillment:', JSON.stringify(order.fulfillmentOrders));

  for (const it of order.items) {
    const [stok] = await p.$queryRawUnsafe(
      'SELECT on_hand AS onHand, reserved, blocked FROM inventory_balances WHERE variant_id = ? AND warehouse_id = ? LIMIT 1', it.variantId, order.fulfillmentOrders[0]?.warehouseId ?? '');
    const res = await p.stockReservation.findMany({
      where: { variantId: it.variantId, status: 'ACTIVE' },
      select: { id: true, quantity: true, orderItemId: true },
    });
    const milikSendiri = res.filter(r => r.orderItemId === it.id).reduce((s, r) => s + r.quantity, 0);
    const resAll = res.reduce((s, r) => s + r.quantity, 0);
    console.log(`- ${it.variant?.sku} | butuh ${it.quantity} (terpenuhi ${it.fulfilledQuantity}) | onHand=${num(stok?.onHand ?? 0)} reserved=${num(stok?.reserved ?? 0)} blocked=${num(stok?.blocked ?? 0)} | reservasiAktif=${resAll} (milik item ini: ${milikSendiri}) | baris reservasi=${res.length}`);
  }
  await p.$disconnect();
})().catch(async e => { console.error('GAGAL:', e.message); await p.$disconnect().catch(()=>{}); process.exit(1); });
JS
ORDER_SN="${ORDER_SN:-261027QHEBBY8Q}" node /tmp/diag-stok.js
rm -f /tmp/diag-stok.js
