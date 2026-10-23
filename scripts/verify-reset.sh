#!/usr/bin/env bash
# Verifikasi ulang setelah skema koreksi stok diperbaiki: kosongkan stok + cek hasil.
set -uo pipefail
cd /opt/efulfill/app
B=http://127.0.0.1:3000
J=/tmp/vp2.txt
rm -f "$J"
curl -s -c "$J" -X POST "$B/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"owner@toko.id","password":"Owner12345"}' -o /dev/null

echo "== kosongkan stok =="
curl -s -b "$J" -X POST "$B/api/v1/inventory/reset-all" -H 'Content-Type: application/json' \
  -d '{"notes":"Kosongkan stok awal oleh owner"}' -o /tmp/reset.json -w "  HTTP %{http_code}\n"
head -c 240 /tmp/reset.json; echo

echo "== stok setelah dikosongkan =="
curl -s -b "$J" "$B/api/v1/catalog/products?pageSize=50" -o /tmp/prod.json
node -e "
const d=JSON.parse(require('fs').readFileSync('/tmp/prod.json','utf8'));
const items=d.data?.items||d.items||[];
let total=0, bukanNol=0; const contoh=[];
for(const p of items) for(const v of (p.variants||[])){ total++; const oh=v.stock?.onHand??0; if(oh!==0){bukanNol++; if(contoh.length<3) contoh.push(v.sku+':'+oh);} }
console.log('  varian:', total, '| stok bukan 0:', bukanNol, contoh.join(' '));
" 2>/dev/null || echo "  (gagal baca katalog)"

echo "== audit pengosongan =="
mysql -N -B -e "select action, count(*) from audit_logs where action in ('stock_reset_all','stock_adjust') and created_at > date_sub(now(), interval 10 minute) group by action" 2>/dev/null || echo "  (skip)"

echo "== kartu tetap sehat =="
curl -s -b "$J" "$B/api/v1/fulfillment/station?range=all&bucket=perluDiproses" -o /tmp/st2.json -w "  HTTP %{http_code}\n"
node -e "
const d=JSON.parse(require('fs').readFileSync('/tmp/st2.json','utf8')).data||{};
console.log('  kartu:', JSON.stringify(d.kartu));
" 2>/dev/null
