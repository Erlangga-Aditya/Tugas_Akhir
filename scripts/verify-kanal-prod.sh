#!/usr/bin/env bash
set -u
cd /opt/efulfill/app || exit 1
echo "=== MD5 ==="
md5sum src/modules/integrations/domain/shipping-channel.ts src/modules/integrations/infrastructure/shopee.adapter.ts
echo
echo "=== KODE BARU ADA? ==="
grep -c "DROP-OFF TANPA CABANG" src/modules/integrations/domain/shipping-channel.ts
grep -c "jawabanShopee" src/modules/integrations/infrastructure/shopee.adapter.ts
echo
echo -n "health: "; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/login
