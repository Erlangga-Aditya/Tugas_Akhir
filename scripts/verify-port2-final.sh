#!/usr/bin/env bash
set -u
cd /opt/efulfill/app || exit 1
echo "=== MD5 (9 berkas + test baru) ==="
md5sum \
  "src/app/api/v1/users/[userId]/route.ts" \
  "src/app/api/v1/users/[userId]/route.test.ts" \
  src/app/dashboard/kelola-tim/page.tsx \
  src/app/login/page.tsx \
  src/components/password-input.tsx \
  src/app/dashboard/laporan/rekap-kerja-staf.tsx \
  src/modules/reports/application/rekap-kerja-staf.usecase.ts \
  src/app/api/v1/reports/rekap-kerja-staf/route.ts \
  prisma/migrations/20261030043346_add_password_changed_at/migration.sql \
  src/modules/reports/application/getTahunTersedia.test.ts
echo
echo "=== MIGRASI ==="
npx prisma migrate status 2>&1 | tail -3
echo
echo "=== HEALTH ==="
echo -n "login: "; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/login
echo -n "rekap: "; curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3000/api/v1/reports/rekap-kerja-staf?tahun=2026&bulan=10&minggu=4"
echo -n "pm2  : "; pm2 pid efulfill 2>/dev/null | tail -1
