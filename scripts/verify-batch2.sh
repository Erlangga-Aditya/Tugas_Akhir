#!/usr/bin/env bash
# Jalur kedua: pemilihan berbeda harus melahirkan batch baru.
set -uo pipefail
cd /opt/efulfill/app
B=http://127.0.0.1:3000
J=/tmp/vb2.txt
rm -f "$J"
curl -s -c "$J" -X POST "$B/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"owner@toko.id","password":"Owner12345"}' -o /dev/null
# ambil 2 orderId pertama dari daftar
IDS=$(curl -s -b "$J" "$B/api/v1/fulfillment/production-list" | node -e "
let s=''; process.stdin.on('data',d=>s+=d).on('end',()=>{
  const d=JSON.parse(s).data||{};
  console.log(JSON.stringify(d.grup[0].pesanan.slice(0,2).map(p=>p.orderId)));
});")
echo "pilih: $IDS"
OUT=$(curl -s -b "$J" -X POST "$B/api/v1/fulfillment/production-list" \
  -H 'Content-Type: application/json' -d "{\"orderIds\":$IDS}" -D - -o /tmp/pdf2.bin)
echo "$OUT" | tr -d '\r' | awk 'tolower($1) ~ /x-batch-(duplikat|kode):/{print "  " $0}'
node -e "
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const rows = await p.productionBatch.findMany({ orderBy: { printedAt: 'asc' },
    select: { kodeBatch: true, totalOrders: true } });
  console.log('  tabel batch:', JSON.stringify(rows));
  await p.\$disconnect();
})().catch(async (e) => { console.error('ERR', e.message); await p.\$disconnect(); process.exit(1); });
" 2>&1 | tail -2