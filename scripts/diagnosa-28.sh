#!/usr/bin/env bash
# Kapan 9 pesanan yatim berubah jadi CANCELLED? + apa isi sync terakhir?
set -uo pipefail
cd /opt/efulfill/app
node -e "
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const ids = ['2610083YNHHKMG','2610083YRTEEWK','2610096AG771M3','261011C12RBHPS','261011C7XGXQU0','261012DS8SDCRG','261013HGV440JX','261014KBWSQR7J','261015PBDEVS76'];
  const rows = await p.order.findMany({
    where: { externalOrderId: { in: ids } },
    select: { externalOrderId: true, status: true, updatedAt: true, cancelRequestedAt: true, cancelledAt: true, createdAt: true,
      fulfillmentOrders: { select: { id: true, status: true, updatedAt: true } } },
    orderBy: { externalOrderId: 'asc' },
  });
  for (const r of rows) console.log(JSON.stringify(r));

  console.log('== 3 sync run terakhir (import_orders) ==');
  const runs = await p.syncRun.findMany({
    where: { operation: 'import_orders' },
    orderBy: { createdAt: 'desc' },
    take: 3,
    select: { createdAt: true, status: true, recordsRead: true, recordsWritten: true, finishedAt: true, errorMessage: true },
  });
  for (const r of runs) console.log('  ', r.createdAt.toISOString(), '|', r.status, '| read:', r.recordsRead, '| write:', r.recordsWritten, '| err:', r.errorMessage);
  await p.\$disconnect();
})().catch(async (e) => { console.error('ERR', e.message); await p.\$disconnect(); process.exit(1); });
" 2>&1 | head -30