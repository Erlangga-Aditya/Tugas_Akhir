#!/usr/bin/env bash
# Verifikasi kartu pembatalan & keterlambatan di produksi.
set -uo pipefail
cd /opt/efulfill/app
B=http://127.0.0.1:3000
J=/tmp/vk.txt
rm -f "$J"

# Build lama yang tertinggal tidak boleh menimpa hasil build baru.
pkill -f "sh -c next build" 2>/dev/null || true
pkill -f "next build" 2>/dev/null || true

curl -s -c "$J" -X POST "$B/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"owner@toko.id","password":"Owner12345"}' -o /dev/null

j() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);const d=o.data??o;console.log(eval(process.argv[1]))})" "$1"; }

echo "== sinkronisasi pesanan (isi cancel_by/cancel_reason) =="
SHOP=$(curl -s -b "$J" "$B/api/v1/shops" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const d=j.data??j;console.log((d[0]||{}).id??'')})")
curl -s -b "$J" -X POST "$B/api/v1/integrations/shopee/sync" -H 'Content-Type: application/json' \
  -d "{\"shopId\":\"$SHOP\"}" -o /tmp/sy.json -w '  HTTP %{http_code}\n'

echo "== kartu kerja + perlu perhatian (semua tanggal) =="
curl -s -b "$J" "$B/api/v1/fulfillment/station?range=all&bucket=perluDiproses&pageSize=1" -o /tmp/v1.json
j "JSON.stringify({kartu:d.kartu,perhatian:d.perhatian,anomali:d.anomali})" < /tmp/v1.json

echo "== saringan pembatalan (semua tanggal) =="
curl -s -b "$J" "$B/api/v1/fulfillment/station?range=all&bucket=semua&kategori=pembatalan&pageSize=50" -o /tmp/v2.json
j "JSON.stringify({total:d.total,pesanan:(d.orders||[]).map(o=>({no:o.externalOrderId,kategori:o.cancelCategory,pelaku:o.cancelBy,alasan:o.buyerCancelReason||o.cancelReason,diajukan:o.cancelRequestedAt,risiko:o.lateRisk}))})" < /tmp/v2.json

echo "== saringan batal sistem (semua tanggal) =="
curl -s -b "$J" "$B/api/v1/fulfillment/station?range=all&bucket=semua&kategori=batalSistem&pageSize=5" -o /tmp/v3.json
j "JSON.stringify({total:d.total,contoh:(d.orders||[]).slice(0,3).map(o=>({no:o.externalOrderId,alasan:o.cancelReason,risiko:o.lateRisk}))})" < /tmp/v3.json

echo "== keterlambatan =="
curl -s -b "$J" "$B/api/v1/fulfillment/station?range=all&bucket=semua&kategori=terlambat&pageSize=5" -o /tmp/v4.json
j "JSON.stringify({terlambat:d.total})" < /tmp/v4.json
curl -s -b "$J" "$B/api/v1/fulfillment/station?range=all&bucket=semua&kategori=besokBatal&pageSize=5" -o /tmp/v5.json
j "JSON.stringify({besokBatal:d.total})" < /tmp/v5.json
curl -s -b "$J" "$B/api/v1/fulfillment/station?range=all&bucket=semua&kategori=beresiko&pageSize=5" -o /tmp/v6.json
j "JSON.stringify({beresiko:d.total})" < /tmp/v6.json
