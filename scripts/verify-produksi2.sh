#!/usr/bin/env bash
# Verifikasi: daftar produksi digabung per produk + urut per merek + PDF ringkas.
set -uo pipefail
cd /opt/efulfill/app
B=http://127.0.0.1:3000
J=/tmp/vg.txt
rm -f "$J"
curl -s -c "$J" -X POST "$B/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"owner@toko.id","password":"Owner12345"}' -o /dev/null

echo "== urutan & penggabungan =="
curl -s -b "$J" "$B/api/v1/fulfillment/production-list" -o /tmp/pl.json -w "  HTTP %{http_code}\n"
node -e "
const d=JSON.parse(require('fs').readFileSync('/tmp/pl.json','utf8')).data||{};
console.log('  total:', d.totalPesanan, 'pesanan /', d.totalUnit, 'unit /', (d.grup||[]).length, 'baris produk');
for (const g of (d.grup||[])) {
  const tanggal = [...new Set(g.pesanan.map(p=>p.tanggal.slice(0,10)))].sort();
  console.log('   -', g.nama.padEnd(20), '|', String(g.totalUnit).padStart(2), 'pcs |', String(g.pesanan.length).padStart(2), 'resi |', tanggal[0], tanggal.length>1?('.. '+tanggal[tanggal.length-1]):'');
}
" 2>/dev/null || head -c 200 /tmp/pl.json

echo "== PDF semua =="
curl -s -b "$J" -X POST "$B/api/v1/fulfillment/production-list" -H 'Content-Type: application/json' -d '{}' \
  -o /tmp/pall.pdf -D /tmp/pall.head -w "  HTTP %{http_code}\n"
grep -i "content-type" /tmp/pall.head | sed 's/^/  /'
echo "  ukuran: $(wc -c < /tmp/pall.pdf) byte"

echo "== PDF 2 produk terpilih =="
IDS=$(node -e "
const d=JSON.parse(require('fs').readFileSync('/tmp/pl.json','utf8')).data||{};
console.log(JSON.stringify((d.grup||[]).slice(0,2).flatMap(g=>g.pesanan.map(p=>p.orderId))));" 2>/dev/null)
curl -s -b "$J" -X POST "$B/api/v1/fulfillment/production-list" -H 'Content-Type: application/json' \
  -d "{\"orderIds\":$IDS}" -o /tmp/psel.pdf -w "  HTTP %{http_code}\n"
echo "  ukuran: $(wc -c < /tmp/psel.pdf) byte"
