#!/usr/bin/env bash
# Hitung angka kartu halaman Pesanan dengan semantik yang SAMA seperti
# classifyWorkQueue, lalu bandingkan dengan Shopee. READ-ONLY.
set -u
cd /opt/efulfill/app || exit 1
set -a; . ./.env; set +a

cat > /tmp/kartu.js <<'JS'
const { PrismaClient } = require('/opt/efulfill/app/node_modules/@prisma/client');
const p = new PrismaClient();

const AWAITING = new Set(['READY_TO_SHIP']);
const PROCESSED = new Set(['PROCESSED', 'RETRY_SHIP']);
const NOT_IN_QUEUE = new Set(['UNPAID','PENDING','IN_CANCEL','TO_RETURN','SHIPPED','TO_CONFIRM_RECEIVE','COMPLETED','CANCELLED']);

(async () => {
  const orders = await p.order.findMany({
    where: { shop: { name: 'Toko Shopee' } },
    select: {
      externalOrderId: true, status: true, externalStatus: true,
      shipments: { select: { awb: true, status: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      fulfillmentOrders: { select: { status: true }, where: { status: { notIn: ['COMPLETED'] } }, take: 1 },
    },
  });
  const has = (o) => Boolean((o.shipments[0]?.awb ?? '').trim());
  const berjalan = (o) => ['PICKED_UP','IN_TRANSIT','DELIVERED'].includes(o.shipments[0]?.status ?? '')
    || o.fulfillmentOrders[0]?.status === 'HANDED_OVER';

  let baru = 0, sudah = 0;
  const legacyBaru = [];
  const rincian = { rts: 0, procAwaited: 0, procTanpaAwb: 0, legacy: 0 };

  for (const o of orders) {
    if (berjalan(o)) continue;
    const ext = (o.externalStatus ?? '').trim().toUpperCase();
    if (ext) {
      if (NOT_IN_QUEUE.has(ext)) continue;
      if (AWAITING.has(ext)) { baru += 1; rincian.rts += 1; continue; }
      if (PROCESSED.has(ext)) {
        if (has(o)) { sudah += 1; rincian.procAwaited += 1; }
        else { baru += 1; rincian.procTanpaAwb += 1; }
        continue;
      }
      continue;
    }
    // Cadangan (baris lama tanpa externalStatus): hanya CONFIRMED yang masih kerja.
    if (o.status === 'CONFIRMED') {
      legacyBaru.push(o.externalOrderId);
      rincian.legacy += 1;
      if (has(o)) sudah += 1; else baru += 1;
    }
  }

  console.log(`KARTU Pesanan Baru   : ${baru}`);
  console.log(`  - READY_TO_SHIP (belum resi)        : ${rincian.rts}`);
  console.log(`  - PROCESSED tanpa AWB (perlu ambil) : ${rincian.procTanpaAwb}`);
  console.log(`  - baris lama CONFIRMED tanpa status : ${rincian.legacy}`);
  console.log(`KARTU Sudah Ada Resi : ${sudah}`);
  console.log(`  - PROCESSED dengan AWB              : ${rincian.procAwaited}`);

  console.log(`\nBaris lama CONFIRMED tanpa externalStatus: ${legacyBaru.length}`);
  console.log(legacyBaru.slice(0, 15).join(', ') || '(tidak ada)');

  const cancelled = orders.filter((o) => o.externalStatus === 'CANCELLED').length;
  const incancel = orders.filter((o) => o.externalStatus === 'IN_CANCEL').length;
  console.log(`\nPembatalan diajukan (IN_CANCEL) : ${incancel}`);
  console.log(`Pesanan batal (CANCELLED)      : ${cancelled}`);

  await p.$disconnect();
})().catch(async (e) => { console.error('GAGAL:', e.message); await p.$disconnect().catch(() => {}); process.exit(1); });
JS

node /tmp/kartu.js
rm -f /tmp/kartu.js
