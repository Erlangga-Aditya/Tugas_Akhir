#!/usr/bin/env bash
# Bukti produksi untuk port 11790f7..209dddd.
set -u
APP=/opt/efulfill/app
cd "$APP" || exit 1

echo "=== 1. MD5 BERKAS KUNCI ==="
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
  2>&1

echo
echo "=== 2. FITUR ADA DI BERKAS TER-DEPLOY ==="
echo -n "PasswordInput di login        : "; grep -c "PasswordInput" src/app/login/page.tsx
echo -n "PasswordInput di kelola-tim   : "; grep -c "PasswordInput" src/app/dashboard/kelola-tim/page.tsx
echo -n "EditAccountForm               : "; grep -c "EditAccountForm" src/app/dashboard/kelola-tim/page.tsx
echo -n "getTahunTersedia (usecase)    : "; grep -c "getTahunTersedia" src/modules/reports/application/rekap-kerja-staf.usecase.ts
echo -n "tahunTersedia (route respons) : "; grep -c "tahunTersedia" src/app/api/v1/reports/rekap-kerja-staf/route.ts
echo -n "header '30 Kam' satu baris    : "; grep -c "k.tgl} {k.hari.slice(0, 3)" src/app/dashboard/laporan/rekap-kerja-staf.tsx

echo
echo "=== 3. MIGRASI ==="
npx prisma migrate status 2>&1 | tail -6

echo
echo "=== 4. KOLOM password_changed_at DI DB ==="
set -a; . ./.env; set +a
cat > /tmp/cek-kolom.js <<'JS'
const { PrismaClient } = require('/opt/efulfill/app/node_modules/@prisma/client');
const p = new PrismaClient();
(async () => {
  const r = await p.$queryRawUnsafe(
    "SELECT COUNT(*) AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'password_changed_at'");
  console.log('kolom ada (1=ya):', Number(r[0].c));
  const u = await p.$queryRawUnsafe('SELECT COUNT(*) AS c FROM users');
  console.log('jumlah user     :', Number(u[0].c));
  await p.$disconnect();
})().catch(async e => { console.error('GAGAL:', e.message); await p.$disconnect().catch(()=>{}); process.exit(1); });
JS
node /tmp/cek-kolom.js
rm -f /tmp/cek-kolom.js

echo
echo "=== 5. HEALTH ==="
echo -n "login: "; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/login
echo -n "rekap (harus 401): "; curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3000/api/v1/reports/rekap-kerja-staf?tahun=2026&bulan=10&minggu=4"
