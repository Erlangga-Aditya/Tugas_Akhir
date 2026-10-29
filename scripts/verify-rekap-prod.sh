#!/usr/bin/env bash
# Verifikasi produksi setelah deploy port tim + fitur Rekap Kerja Staf.
# Dijalankan DI SERVER oleh scripts/vps-deploy-paramiko.py (mode verifikasi).
set -u
APP=/opt/efulfill/app
cd "$APP" || { echo "APP_DIR tidak ada"; exit 1; }

echo "=== 1. MD5 BERKAS KUNCI ==="
md5sum \
  src/modules/reports/domain/minggu-gaji.ts \
  src/modules/reports/application/rekap-kerja-staf.usecase.ts \
  src/app/api/v1/reports/rekap-kerja-staf/route.ts \
  src/app/dashboard/laporan/rekap-kerja-staf.tsx \
  src/app/dashboard/laporan/page.tsx \
  src/app/dashboard/pesanan/page.tsx \
  src/modules/integrations/infrastructure/shopee.adapter.ts \
  src/modules/integrations/application/sync.service.ts \
  prisma/migrations/20261030040000_fulfillment_actor_timestamp_index/migration.sql \
  2>&1

echo
echo "=== 2. BERKAS YANG HARUS SUDAH HILANG ==="
if [ -f src/app/dashboard/pesanan/operasional-section.tsx ]; then
  echo "MASIH ADA: operasional-section.tsx (port belum bersih)"
else
  echo "OK: operasional-section.tsx sudah tidak ada"
fi

echo
echo "=== 3. LABEL URUTAN (port 61ecab1) ==="
grep -c "Tenggat terdekat" src/app/dashboard/pesanan/page.tsx
grep -c "Terlama dulu" src/app/dashboard/pesanan/page.tsx

echo
echo "=== 4. STATUS MIGRASI PRISMA ==="
npx prisma migrate status 2>&1 | tail -8

echo
echo "=== 5. ENDPOINT BARU (harus 401 tanpa login, BUKAN 404) ==="
echo -n "rekap-kerja-staf: "
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3000/api/v1/reports/rekap-kerja-staf?tahun=2026&bulan=10&minggu=4"
echo -n "login            : "
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3000/login"

echo
echo "=== 6. PM2 ==="
pm2 list 2>/dev/null | grep -E "efulfill|status" | head -5
