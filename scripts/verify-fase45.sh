#!/usr/bin/env bash
# Verifikasi Fase 4 (pemilihan owner) & Fase 5 (PDF daftar produksi).
# Tidak ada perubahan data: hanya GET, dan POST yang sengaja ditolak validasi.
set -uo pipefail
cd /opt/efulfill/app
B=http://127.0.0.1:3000
J=/tmp/v45.txt
rm -f "$J"
curl -s -c "$J" -X POST "$B/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"owner@toko.id","password":"Owner12345"}' -o /dev/null

echo "== 1. saran urutan kerja =="
curl -s -b "$J" "$B/api/v1/fulfillment/selection?limit=5" -o /tmp/s.json -w "  HTTP %{http_code}\n"
node -e "
const d=JSON.parse(require('fs').readFileSync('/tmp/s.json','utf8')).data||{};
const s=d.saran||[];
console.log('  jumlah saran:', s.length);
console.log('  urutan tenggat:', s.map(x=>x.alasan).join(' | '));
console.log('  contoh:', JSON.stringify(s.slice(0,2).map(x=>({no:x.externalOrderId,alasan:x.alasan}))));
" 2>/dev/null || head -c 200 /tmp/s.json

echo "== 2. PDF daftar produksi =="
curl -s -b "$J" "$B/api/v1/fulfillment/production-list" -o /tmp/prod.pdf -D /tmp/prod.head -w "  HTTP %{http_code}\n"
grep -i "content-type\|content-disposition" /tmp/prod.head | sed 's/^/  /'
echo "  ukuran: $(wc -c < /tmp/prod.pdf) byte"
head -c 5 /tmp/prod.pdf | od -c | head -1

echo "== 3. validasi TUNDA tanpa alasan (harus ditolak, tanpa efek) =="
curl -s -b "$J" -X POST "$B/api/v1/fulfillment/selection" -H 'Content-Type: application/json' \
  -d '{"orderIds":["x"],"aksi":"TUNDA","alasan":"ok"}' -o /tmp/t.json -w "  HTTP %{http_code}\n"
head -c 200 /tmp/t.json; echo

echo "== 4. validasi aksi tak dikenal =="
curl -s -b "$J" -X POST "$B/api/v1/fulfillment/selection" -H 'Content-Type: application/json' \
  -d '{"orderIds":["x"],"aksi":"HAPUS"}' -o /tmp/t2.json -w "  HTTP %{http_code}\n"
head -c 200 /tmp/t2.json; echo
