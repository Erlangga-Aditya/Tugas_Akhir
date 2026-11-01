#!/usr/bin/env bash
# Riwayat lengkap satu pesanan: status, pengiriman, fulfillment, audit. READ-ONLY.
set -u
cd /opt/efulfill/app || exit 1
set -a; . ./.env; set +a
ORDER_SN="${ORDER_SN:-2610301FP9NBWQ}"

cat > /tmp/rw.js <<'JS'
const { PrismaClient } = require('/opt/efulfill/app/node_modules/@prisma/client');
const p = new PrismaClient();
const SN = process.env.ORDER_SN || '2610301FP9NBWQ';

(async () => {
  const o = await p.order.findFirst({
    where: { externalOrderId: SN },
    include: {
      shipments: { orderBy: { createdAt: 'asc' } },
      fulfillmentOrders: { include: { pickingTasks: true }, orderBy: { createdAt: 'asc' } },
    },
  });
  if (!o) { console.log('tidak ada'); return; }

  console.log('=== PESANAN ===');
  console.log(JSON.stringify({
    id: o.id, sn: o.externalOrderId, status: o.status, externalStatus: o.externalStatus,
    placedAt: o.placedAt, shipByAt: o.shipByAt, packageNumber: o.packageNumber, packageCount: o.packageCount,
  }, null, 1));

  console.log('\n=== PENGIRIMAN ===');
  for (const s of o.shipments) {
    console.log(JSON.stringify({ id: s.id, awb: s.awb, carrier: s.carrier, status: s.status,
      shippedAt: s.shippedAt, deliveredAt: s.deliveredAt, createdAt: s.createdAt }));
  }

  console.log('\n=== FULFILLMENT ===');
  for (const f of o.fulfillmentOrders) {
    console.log(JSON.stringify({ id: f.id, status: f.status, createdAt: f.createdAt,
      startedAt: f.startedAt, pickedAt: f.pickedAt, packedAt: f.packedAt,
      completedAt: f.completedAt, handedOverAt: f.handedOverAt,
      packedById: f.packedById, handedOverById: f.handedOverById,
      pickedById: f.pickedById, pickingTasks: f.pickingTasks.length }));
  }

  console.log('\n=== AUDIT (30 terakhir untuk pesanan/F fulfillment ini) ===');
  const ids = [o.id, ...o.fulfillmentOrders.map((f) => f.id)];
  const logs = await p.auditLog.findMany({
    where: { entityId: { in: ids } },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: { createdAt: true, action: true, entityType: true, actorId: true, metadata: true },
  });
  for (const l of logs) {
    console.log(`${l.createdAt.toISOString()} | ${l.action} | ${l.entityType} | actor=${l.actorId ?? '-'} | ${JSON.stringify(l.metadata).slice(0, 160)}`);
  }

  console.log('\n=== EVENT PELACAKAN ===');
  const ev = await p.trackingEvent.findMany({
    where: { shipment: { orderId: o.id } },
    orderBy: { occurredAt: 'desc' },
    take: 15,
    select: { occurredAt: true, status: true, description: true },
  });
  for (const e of ev) console.log(`${e.occurredAt.toISOString()} | ${e.status} | ${e.description}`);

  await p.$disconnect();
})().catch(async (e) => { console.error('GAGAL:', e.message); await p.$disconnect().catch(() => {}); process.exit(1); });
JS

ORDER_SN="$ORDER_SN" node /tmp/rw.js
rm -f /tmp/rw.js
