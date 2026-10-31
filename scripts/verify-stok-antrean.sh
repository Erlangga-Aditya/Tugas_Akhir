#!/usr/bin/env bash
set -u
cd /opt/efulfill/app || exit 1
set -a; . ./.env; set +a
cat > /tmp/stok.js <<'JS'
const { PrismaClient } = require('/opt/efulfill/app/node_modules/@prisma/client');
const p = new PrismaClient();
const num = v => typeof v === 'bigint' ? Number(v) : v;
(async () => {
  const fos = await p.fulfillmentOrder.findMany({
    where: { status: 'WAITING_STOCK' },
    select: { order: { select: { externalOrderId: true, items: { select: { id:true, quantity:true, fulfilledQuantity:true, variant: { select: { sku:true } } } } } } },
  });
  console.log(`Pesanan menunggu stok: ${fos.length}`);
  const skus = new Map();
  for (const fo of fos) for (const it of fo.order.items) {
    const key = it.variant.sku;
    skus.set(key, (skus.get(key) ?? 0) + (it.quantity - it.fulfilledQuantity));
  }
  for (const [sku, butuh] of skus) {
    const v = await p.productVariant.findFirst({ where: { sku }, select: { id: true } });
    const bal = v ? await p.inventoryBalance.findMany({ where: { variantId: v.id }, select: { onHand:true, reserved:true, blocked:true, warehouse: { select: { name:true } } } }) : [];
    const totalOnHand = bal.reduce((s,b)=>s+b.onHand,0);
    const totalReserved = bal.reduce((s,b)=>s+b.reserved,0);
    const tersedia = totalOnHand - totalReserved - bal.reduce((s,b)=>s+b.blocked,0);
    console.log(`${sku} | butuh ${butuh} | onHand ${totalOnHand} | reserved ${totalReserved} | tersedia ${tersedia} | ${tersedia < butuh ? 'KURANG' : 'cukup'}`);
  }
  await p.$disconnect();
})().catch(async e => { console.error('GAGAL:', e.message); await p.$disconnect().catch(()=>{}); process.exit(1); });
JS
node /tmp/stok.js
rm -f /tmp/stok.js
