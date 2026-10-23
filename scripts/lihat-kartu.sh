#!/usr/bin/env bash
# Angka yang user lihat: badge & kartu Pesanan + isi antrian "Perlu Diproses".
set -uo pipefail
cd /opt/efulfill/app
B=http://127.0.0.1:3000
J=/tmp/vq.txt
rm -f "$J"
curl -s -c "$J" -X POST "$B/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"owner@toko.id","password":"Owner12345"}' -o /dev/null
echo "== badge =="
curl -s -b "$J" "$B/api/v1/orders/badge" -w "\n  HTTP %{http_code}\n" | head -c 600; echo
echo "== antrian pesanan (default) =="
curl -s -b "$J" "$B/api/v1/orders/queue" -o /tmp/q.json -w "  HTTP %{http_code}\n"
node -e "
const d = JSON.parse(require('fs').readFileSync('/tmp/q.json','utf8')).data || {};
console.log('keys:', Object.keys(d).join(','));
const k = d.kartu || d.cards || d.summary || {};
console.log('kartu:', JSON.stringify(k));
" 2>/dev/null || head -c 400 /tmp/q.json
