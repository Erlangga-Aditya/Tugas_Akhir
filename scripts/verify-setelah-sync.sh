#!/usr/bin/env bash
# Sinkronisasi penuh dari Shopee (sumber kebenaran) + verifikasi ulang section.
set -uo pipefail
cd /opt/efulfill/app
B=http://127.0.0.1:3000
J=/tmp/vs.txt
rm -f "$J"
curl -s -c "$J" -X POST "$B/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"owner@toko.id","password":"Owner12345"}' -o /dev/null

echo "== trigger full sync =="
curl -s -b "$J" -X POST "$B/api/v1/integrations/shopee/sync" \
  -H 'Content-Type: application/json' -d '{"full":true}' -o /tmp/sync.json \
  -w "  HTTP %{http_code}\n" --max-time 540
head -c 300 /tmp/sync.json; echo

echo "== kondisi pesanan SETELAH sync (yang masih di daftar produksi) =="
curl -s -b "$J" "$B/api/v1/fulfillment/production-list" -o /tmp/pl4.json -w "  HTTP %{http_code}\n"
node -e "
const d=JSON.parse(require('fs').readFileSync('/tmp/pl4.json','utf8')).data||{};
console.log('  baris produk:', (d.grup||[]).length, '| pesanan:', d.totalPesanan, '| unit:', d.totalUnit);
console.log('  mendesak:', (d.mendesak||[]).length);
for (const m of (d.mendesak||[])) {
  const b = new Date(m.batasKirim).toLocaleString('id-ID',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  console.log('   -', m.nama.padEnd(18), '|', String(m.qty).padStart(2), 'pcs |', b.padEnd(20), '|', m.sisaTeks, '(', m.nada, ')');
}
" 2>/dev/null || head -c 300 /tmp/pl4.json
