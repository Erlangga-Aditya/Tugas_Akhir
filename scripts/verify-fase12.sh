#!/usr/bin/env bash
# Verifikasi Fase 1 & 2 tanpa efek samping:
#  - izin.setujuiPembatalan dikirim server (OWNER)
#  - jejak aktor ada di payload
#  - endpoint pembatalan menolak operasi REJECT dan pesanan bukan pengajuan
#    (TIDAK membatalkan pesanan asli mana pun)
set -uo pipefail
cd /opt/efulfill/app
B=http://127.0.0.1:3000
J=/tmp/vc.txt
rm -f "$J"
curl -s -c "$J" -X POST "$B/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"owner@toko.id","password":"Owner12345"}' -o /dev/null
j() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);const d=o.data??o;console.log(eval(process.argv[1]))})" "$1"; }

echo "== 1. izin + jejak aktor di payload =="
curl -s -b "$J" "$B/api/v1/fulfillment/station?range=all&bucket=semua&kategori=pembatalan&pageSize=5" -o /tmp/f1.json
j "JSON.stringify({izin:d.izin, total:d.total, contoh:(d.orders||[]).map(o=>({no:o.externalOrderId,kategori:o.cancelCategory,aktor:o.aktor}))})" < /tmp/f1.json

echo "== 2. endpoint menolak REJECT (tanpa efek samping) =="
OID=$(node -e "const d=JSON.parse(require('fs').readFileSync('/tmp/f1.json','utf8')).data;console.log((d.orders||[])[0]?.orderId||'')")
if [ -n "$OID" ]; then
  curl -s -b "$J" -X POST "$B/api/v1/orders/$OID/cancellation" -H 'Content-Type: application/json' \
    -d '{"operation":"REJECT"}' -o /tmp/f2.json -w '  HTTP %{http_code}\n'
  head -c 220 /tmp/f2.json; echo
else
  echo "  (tidak ada pesanan pembatalan)"
fi

echo "== 3. endpoint menolak pesanan yang bukan pengajuan =="
OTHER=$(curl -s -b "$J" "$B/api/v1/fulfillment/station?range=all&bucket=perluDiproses&pageSize=1" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s).data;console.log((d.orders||[])[0]?.orderId||'')})")
if [ -n "$OTHER" ]; then
  curl -s -b "$J" -X POST "$B/api/v1/orders/$OTHER/cancellation" -H 'Content-Type: application/json' \
    -d '{"operation":"ACCEPT"}' -o /tmp/f3.json -w '  HTTP %{http_code}\n'
  head -c 220 /tmp/f3.json; echo
fi

echo "== 4. jejak aktor pada pesanan yang sudah dipacking/diserahkan =="
curl -s -b "$J" "$B/api/v1/fulfillment/station?range=all&bucket=semua&pageSize=100" -o /tmp/f4.json
node -e "
const d=JSON.parse(require('fs').readFileSync('/tmp/f4.json','utf8')).data;
const ada=(d.orders||[]).filter(o=>o.aktor&&(o.aktor.packedByNama||o.aktor.handedOverByNama));
console.log('  pesanan dengan jejak aktor:', ada.length);
console.log('  contoh:', JSON.stringify(ada.slice(0,2).map(o=>({no:o.externalOrderId,packed:o.aktor.packedByNama,handed:o.aktor.handedOverByNama}))));
"
