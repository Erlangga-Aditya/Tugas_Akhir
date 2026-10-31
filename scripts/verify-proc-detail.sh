#!/usr/bin/env bash
set -u
cd /opt/efulfill/app || exit 1
set -a; . ./.env; set +a
cat > /tmp/proc.js <<'JS'
const { PrismaClient } = require('/opt/efulfill/app/node_modules/@prisma/client');
const p = new PrismaClient();
(async () => {
  const rows = await p.order.findMany({
    where: { externalStatus: { in: ['PROCESSED','RETRY_SHIP'] } },
    select: { externalOrderId: true, externalStatus: true,
      shipments: { select: { awb: true, status: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      fulfillmentOrders: { select: { status: true }, take: 1 } },
    orderBy: { externalOrderId: 'asc' },
  });
  for (const r of rows) {
    const s = r.shipments[0];
    const berjalan = ['PICKED_UP','IN_TRANSIT','DELIVERED'].includes(s?.status ?? '')
      || r.fulfillmentOrders[0]?.status === 'HANDED_OVER';
    console.log(`${r.externalOrderId} | ${r.externalStatus} | awb=${s?.awb ?? '-'} | shipment=${s?.status ?? '-'} | fo=${r.fulfillmentOrders[0]?.status ?? '-'} | ${berjalan ? 'DI LUAR antrean (paket jalan)' : 'DI antrean'}`);
  }
  await p.$disconnect();
})().catch(async e => { console.error('GAGAL:', e.message); await p.$disconnect().catch(()=>{}); process.exit(1); });
JS
node /tmp/proc.js
rm -f /tmp/proc.js
