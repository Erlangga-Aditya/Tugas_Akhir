#!/usr/bin/env bash
set -u
APP=/opt/efulfill/app
cd "$APP" || exit 1
set -a; . ./.env; set +a
cat > /tmp/checkstatus.js <<'JS'
const { PrismaClient } = require('/opt/efulfill/app/node_modules/@prisma/client');
const p = new PrismaClient();
const num = v => typeof v === 'bigint' ? Number(v) : v;
(async () => {
  const st = await p.$queryRawUnsafe('SELECT status, COUNT(*) AS c FROM fulfillment_orders GROUP BY status');
  console.log('status fulfillment_orders:', st.map(r => `${r.status}=${num(r.c)}`).join(', '));
  const ship = await p.$queryRawUnsafe('SELECT status, COUNT(*) AS c FROM shipments GROUP BY status');
  console.log('status shipments        :', ship.map(r => `${r.status}=${num(r.c)}`).join(', '));
  const pk = await p.$queryRawUnsafe('SELECT COUNT(*) AS c FROM packing_tasks');
  console.log('packing_tasks           :', num(pk[0].c));
  await p.$disconnect();
})().catch(async e => { console.error('GAGAL:', e.message); await p.$disconnect().catch(()=>{}); process.exit(1); });
JS
node /tmp/checkstatus.js
rm -f /tmp/checkstatus.js
