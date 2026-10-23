#!/usr/bin/env bash
# Fase 6 — batasi log PM2 agar disk tidak penuh lagi karena log aplikasi.
# Aman diulang (idempoten): memasang bila belum ada, lalu menerapkan setelan.
set -uo pipefail
export PATH="$PATH:/usr/local/bin:/usr/bin"
PM2=$(command -v pm2 || echo /usr/lib/node_modules/pm2/bin/pm2)

echo "== pm2-logrotate sebelum =="
$PM2 list 2>/dev/null | grep -i logrotate || echo "  (belum terpasang)"

echo "== pasang modul =="
$PM2 install pm2-logrotate 2>&1 | tail -3

echo "== setelan: 10 MB per berkas, simpan 5, kompres =="
$PM2 set pm2-logrotate:max_size 10M 2>&1 | tail -1
$PM2 set pm2-logrotate:retain 5 2>&1 | tail -1
$PM2 set pm2-logrotate:compress true 2>&1 | tail -1
$PM2 set pm2-logrotate:rotateInterval '0 0 * * *' 2>&1 | tail -1

echo "== hasil =="
$PM2 conf pm2-logrotate 2>/dev/null | grep -E "max_size|retain|compress|rotateInterval" || \
  $PM2 list 2>/dev/null | grep -i logrotate

echo "== ukuran log sekarang =="
du -sh /root/.pm2/logs 2>/dev/null | tail -1
ls -lh /root/.pm2/logs 2>/dev/null | tail -3
df -h / | tail -1
