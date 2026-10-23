#!/usr/bin/env bash
# Ground truth lengkap: ambil daftar "mendesak" dari API, lalu cek baris DB-nya.
set -uo pipefail
cd /opt/efulfill/app
B=http://127.0.0.1:3000
J=/tmp/vk.txt
rm -f "$J"
curl -s -c "$J" -X POST "$B/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"owner@toko.id","password":"Owner12345"}' -o /dev/null
curl -s -b "$J" "$B/api/v1/fulfillment/production-list" -o /tmp/pl3.json
node -e "
const d = JSON.parse(require('fs').readFileSync('/tmp/pl3.json','utf8')).data || {};
const ids = (d.mendesak||[]).map(m => m.externalOrderId);
console.log('mendesak dari API:', JSON.stringify(ids));
require('fs').writeFileSync('/tmp/mids.json', JSON.stringify(ids));
"
node -e "
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const ids = JSON.parse(require('fs').readFileSync('/tmp/mids.json','utf8'));
  const rows = await p.fulfillmentOrder.findMany({
    where: { order: { externalOrderId: { in: ids } } },
    select: { status: true, updatedAt: true,
              order: { select: { externalOrderId: true, status: true, externalStatus: true,
                                 placedAt: true, shipByAt: true, updatedAt: true,
                                 cancelRequestedAt: true, cancelledAt: true } } },
    orderBy: { updatedAt: 'desc' },
  });
  for (const r of rows) console.log(JSON.stringify(r));
  const t = await p.fulfillmentOrder.count({ where: { status: 'WAITING_STOCK' } });
  console.log('WAITING_STOCK total:', t);
  await p.\$disconnect();
})().catch(async (e) => { console.error('ERR', e.message); await p.\$disconnect(); process.exit(1); });
" 2>&1 | head -16