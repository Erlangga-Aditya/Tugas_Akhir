#!/usr/bin/env bash
# Cek kesehatan VPS: disk, binlog, aplikasi, status migrasi.
#
# Dipakai bersama scripts/vps-deploy-paramiko.py:
#   VPS_PASS='...' VPS_SCRIPT='vps-health.sh' \
#     uv run --with paramiko python scripts/vps-deploy-paramiko.py verify
set -uo pipefail
cd /opt/efulfill/app

echo "== disk =="
df -h / | tail -1
echo "binlog: $(ls /var/lib/mysql/binlog.* 2>/dev/null | wc -l) berkas, $(du -ch /var/lib/mysql/binlog.* 2>/dev/null | tail -1 | cut -f1)"
echo "retensi binlog: $(mysql -N -B -e 'select @@binlog_expire_logs_seconds' 2>/dev/null) detik"

echo "== aplikasi =="
pm2 jlist 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const a=JSON.parse(s);console.log(a.map(p=>p.name+':'+p.pm2_env.status+' (restart '+p.pm2_env.restart_time+')').join(' '))}catch(e){console.log('(pm2 tidak terbaca)')}})"
echo "health: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/login)"

echo "== migrasi =="
timeout 90 npx prisma migrate status 2>&1 | tail -2

echo "== ukuran database =="
mysql -N -B -e "select concat(round(sum(data_length+index_length)/1024/1024,1),' MB') from information_schema.tables where table_schema=database()" 2>/dev/null
