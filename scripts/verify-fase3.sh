#!/usr/bin/env bash
# Verifikasi Fase 3: ringkasan operasional owner (tanpa efek samping).
set -uo pipefail
cd /opt/efulfill/app
B=http://127.0.0.1:3000
J=/tmp/vr.txt
rm -f "$J"
curl -s -c "$J" -X POST "$B/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"owner@toko.id","password":"Owner12345"}' -o /dev/null

show() {
  curl -s -b "$J" "$B/api/v1/reports/operations?range=$1" -o /tmp/r.json -w "  HTTP %{http_code}\n"
  node -e "
const d=JSON.parse(require('fs').readFileSync('/tmp/r.json','utf8')).data||{};
console.log('  tahap   :', JSON.stringify(d.tahap));
console.log('  kejadian:', JSON.stringify(d.kejadian));
console.log('  packing :', JSON.stringify(d.packing));
console.log('  serah    :', JSON.stringify(d.serahTerima));
" 2>/dev/null || head -c 200 /tmp/r.json
}

echo "== rentang: hari ini =="; show today
echo "== rentang: semua =="; show all
echo "== halaman laporan memuat komponen (cek HTML) =="
curl -s -b "$J" "$B/dashboard/laporan" | grep -c "Operasional Gudang" || echo "  0 (komponen klien, wajar tidak ada di HTML awal)"
