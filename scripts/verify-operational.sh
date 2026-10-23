#!/usr/bin/env bash
# Verifikasi deployment: API operasi & page render.
set -uo pipefail
B=http://127.0.0.1:3000
J=/tmp/vro.txt
rm -f "$J"
echo "=== login ==="
curl -s -c "$J" -X POST "$B/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"owner@toko.id","password":"Owner12345"}' -o /dev/null -w "login %{http_code}\n"
echo "=== operations API ==="
curl -s -b "$J" "$B/api/v1/reports/operations?range=today" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print('preset:', d['preset'])
print('tahap:', d.get('tahap'))
print('kejadian:', d.get('kejadian'))
" 2>&1 | tail -5
echo "=== orders page metadata ==="
curl -s -b "$J" -I "$B/dashboard/pesanan" | head -5
echo "=== laporan page metadata ==="
curl -s -b "$J" -I "$B/dashboard/laporan" | head -5