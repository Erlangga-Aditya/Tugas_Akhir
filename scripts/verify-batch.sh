#!/usr/bin/env bash
# Verifikasi fitur batch: cetak → catat; cetak ulang sama → DUPLIKAT (tanpa baris baru).
set -uo pipefail
cd /opt/efulfill/app
B=http://127.0.0.1:3000
J=/tmp/vb.txt
rm -f "$J"
curl -s -c "$J" -X POST "$B/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"owner@toko.id","password":"Owner12345"}' -o /dev/null

cek() {
  # $1 = label, $2 = body ("" = semua)
  local label="$1" body="$2"
  local out h1 h2 h3
  out=$(curl -s -b "$J" -X POST "$B/api/v1/fulfillment/production-list" \
    -H 'Content-Type: application/json' -d "$body" -D - -o /tmp/pdf.bin)
  h1=$(echo "$out" | tr -d '\r' | awk 'tolower($1)=="x-batch-duplikat:"{print $2}')
  h2=$(echo "$out" | tr -d '\r' | awk 'tolower($1)=="x-batch-kode:"{print $2}')
  h3=$(echo "$out" | tr -d '\r' | awk 'tolower($1)=="x-batch-dicetak-pada:"{print $2}')
  echo "$label -> duplikat=${h1:-?} kode=${h2:-?} ukuran=$(wc -c < /tmp/pdf.bin) dicetak=${h3:-?}"
}

echo "== cetak SEMUA (1x) =="
cek "cetak-1" '{}'
echo "== cetak SEMUA (2x, set sama) =="
cek "cetak-2" '{}'
echo "== cetak SEMUA (3x, set sama) =="
cek "cetak-3" '{}'

echo "== GET: terakhirDicetak =="
curl -s -b "$J" "$B/api/v1/fulfillment/production-list" -o /tmp/pl5.json -w "  HTTP %{http_code}\n"
node -e "
const d=JSON.parse(require('fs').readFileSync('/tmp/pl5.json','utf8')).data||{};
console.log('  terakhirDicetak:', JSON.stringify(d.terakhirDicetak));
console.log('  pesanan:', d.totalPesanan, '| baris:', (d.grup||[]).length);
" 2>/dev/null

echo "== jumlah baris di tabel production_batches =="
node -e "
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const rows = await p.productionBatch.findMany({ orderBy: { printedAt: 'asc' },
    select: { kodeBatch: true, totalOrders: true, totalUnits: true } });
  console.log(' ', JSON.stringify(rows));
  await p.\$disconnect();
})().catch(async (e) => { console.error('ERR', e.message); await p.\$disconnect(); process.exit(1); });
" 2>&1 | tail -3