#!/usr/bin/env bash
# Bukti perbaikan kartu + pemulihan AWB di produksi (READ-ONLY).
set -u
APP=/opt/efulfill/app
cd "$APP" || exit 1

echo "=== 1. MD5 BERKAS YANG BERUBAH ==="
md5sum \
  src/modules/fulfillment/domain/work-queue.ts \
  src/modules/shipping/domain/shipment-status.ts \
  src/modules/integrations/application/sync.service.ts \
  src/modules/fulfillment/domain/work-queue.test.ts \
  src/modules/shipping/domain/shipment-status.test.ts

echo
echo "=== 2. KODE BARU AKTIF? ==="
echo -n "bucket ikut AWB (work-queue)   : "; grep -c "input.hasAwb ? 'sudahResi' : 'baru'" src/modules/fulfillment/domain/work-queue.ts
echo -n "isAwbMissing (domain shipping) : "; grep -c "export function isAwbMissing" src/modules/shipping/domain/shipment-status.ts
echo -n "pemulihan di tracking sync     : "; grep -c "Pulihkan AWB yang belum tersimpan" src/modules/integrations/application/sync.service.ts

echo
echo "=== 3. KONDISI DATA PESANAN ==="
set -a; . ./.env; set +a
cat > /tmp/cek-bucket.js <<'JS'
const { PrismaClient } = require('/opt/efulfill/app/node_modules/@prisma/client');
const p = new PrismaClient();
const num = (v) => (typeof v === 'bigint' ? Number(v) : v);

(async () => {
  const orders = await p.order.findMany({
    where: { shop: { name: 'Toko Shopee' } },
    select: {
      externalOrderId: true, externalStatus: true,
      shipments: { select: { awb: true, status: true }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
  const has = (o) => Boolean((o.shipments[0]?.awb ?? '').trim());

  const rts = orders.filter((o) => o.externalStatus === 'READY_TO_SHIP');
  const proc = orders.filter((o) => ['PROCESSED', 'RETRY_SHIP'].includes(o.externalStatus ?? ''));
  const incancel = orders.filter((o) => o.externalStatus === 'IN_CANCEL');

  console.log(`READY_TO_SHIP (belum resi)      : ${rts.length} | tanpa AWB: ${rts.filter((o) => !has(o)).length}`);
  console.log(`PROCESSED/RETRY_SHIP (sudah resi): ${proc.length} | dengan AWB: ${proc.filter(has).length} | TANPA AWB: ${proc.filter((o) => !has(o)).length}`);
  console.log(`IN_CANCEL                        : ${incancel.length}`);

  const tanpaAwb = proc.filter((o) => !has(o)).map((o) => o.externalOrderId);
  console.log(`PROCESSED tanpa AWB tersisa: ${tanpaAwb.length ? tanpaAwb.join(', ') : '(tidak ada) ✅'}`);

  const patokan = ['261025J0ES0UC8', '261025J6KDATXP', '261025J6Q6E3HG', '261027QD9X6AAU'];
  console.log('\n4 pesanan yang sebelumnya tanpa AWB:');
  for (const sn of patokan) {
    const o = orders.find((x) => x.externalOrderId === sn);
    console.log(`  ${sn} | status=${o?.externalStatus ?? '-'} | awb=${o?.shipments[0]?.awb ?? '(kosong)'} | shipment=${o?.shipments[0]?.status ?? '-'}`);
  }

  // Kartu: pesanan baru = READY_TO_SHIP ATAU PROCESSED tanpa AWB; sudah resi = PROCESSED dengan AWB.
  const baru = rts.length + proc.filter((o) => !has(o)).length + orders.filter((o) => !o.externalStatus && !has(o)).length;
  const sudah = proc.filter(has).length;
  console.log(`\nKARTU Pesanan Baru   : ${baru} (semuanya memang perlu ambil resi)`);
  console.log(`KARTU Sudah Ada Resi : ${sudah} (semuanya punya AWB)`);

  await p.$disconnect();
})().catch(async (e) => { console.error('GAGAL:', e.message); await p.$disconnect().catch(() => {}); process.exit(1); });
JS
node /tmp/cek-bucket.js
rm -f /tmp/cek-bucket.js

echo
echo "=== 4. HEALTH ==="
echo -n "login: "; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/login
echo -n "station (401 tanpa login): "; curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3000/api/v1/fulfillment/station?bucket=sudahResi"
