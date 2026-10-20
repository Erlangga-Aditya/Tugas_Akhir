#!/usr/bin/env bash
# Verifikasi di produksi: paket in-transit tidak lagi meminta tambah stok,
# dan catatan fulfillment yang tertinggal bisa ditutup tanpa dobel potong stok.
set -uo pipefail
# Dijalankan dari /root; .env produksi ada di direktori aplikasi.
cd /opt/efulfill/app
B=http://127.0.0.1:3000
J=/tmp/vf.txt
rm -f "$J"

curl -s -c "$J" -X POST "$B/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"owner@toko.id","password":"Owner12345"}' -o /dev/null

j() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);const d=o.data??o;console.log(eval(process.argv[1]))})" "$1"; }

echo "== 1. Keadaan awal (kartu + anomali) =="
curl -s -b "$J" "$B/api/v1/fulfillment/station?range=all&bucket=perluDiproses&pageSize=100" -o /tmp/s1.json
j "JSON.stringify({kartu:d.kartu,anomali:d.anomali})" < /tmp/s1.json

# Ambil satu AWB paket yang SUDAH keluar gudang langsung dari database.
DBURL=$(grep '^DATABASE_URL' .env | cut -d= -f2- | tr -d '"')
DBUSER=$(echo "$DBURL" | sed -E 's#mysql://([^:]+):([^@]+)@.*#\1#')
DBPASS=$(echo "$DBURL" | sed -E 's#mysql://([^:]+):([^@]+)@.*#\2#')
DBNAME=$(echo "$DBURL" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')
AWB=$(mysql -u"$DBUSER" -p"$DBPASS" "$DBNAME" -N -B -e "
  select s.awb from shipments s
    join orders o on o.id = s.order_id
   where s.status in ('PICKED_UP','IN_TRANSIT','DELIVERED')
     and s.awb is not null and s.awb <> ''
     and o.status <> 'CANCELLED'
   order by s.updated_at desc limit 1;" 2>/dev/null)

echo "AWB uji: ${AWB:-'(tidak ada di halaman 1)'}"

echo "== 2. Scan AWB paket yang sudah di jalan =="
if [ -n "$AWB" ]; then
  curl -s -b "$J" -X POST "$B/api/v1/fulfillment/scan-awb" -H 'Content-Type: application/json' \
    -d "{\"scannedCode\":\"$AWB\",\"confirmPicking\":true}" -o /tmp/sc1.json
  j "JSON.stringify({code:d.code,stockDeducted:d.stockDeducted,deductedUnits:d.deductedUnits,pesan:(d.message||'').slice(0,120)})" < /tmp/sc1.json
fi

echo "== 3. Rekonsiliasi: pratinjau (tidak mengubah apa pun) =="
curl -s -b "$J" -X POST "$B/api/v1/fulfillment/reconcile-shipped" -H 'Content-Type: application/json' \
  -d '{"apply":false}' -o /tmp/rc0.json
j "JSON.stringify({diperiksa:d.diperiksa,perluDitutup:d.perluDitutup,ditutup:d.ditutup,messages:d.messages})" < /tmp/rc0.json

echo "== 4. Rekonsiliasi: terapkan =="
curl -s -b "$J" -X POST "$B/api/v1/fulfillment/reconcile-shipped" -H 'Content-Type: application/json' \
  -d '{"apply":true}' -o /tmp/rc1.json
j "JSON.stringify({ditutup:d.ditutup,unitStokDipotong:d.unitStokDipotong,varianStokMinus:d.varianStokMinus,dilewati:d.dilewati,messages:d.messages})" < /tmp/rc1.json

echo "== 5. Keadaan sesudah rekonsiliasi =="
curl -s -b "$J" "$B/api/v1/fulfillment/station?range=all&bucket=perluDiproses&pageSize=100" -o /tmp/s2.json
j "JSON.stringify({kartu:d.kartu,anomali:d.anomali})" < /tmp/s2.json

echo "== 6. Scan ulang AWB yang sama (harus tetap informatif, bukan stok) =="
if [ -n "$AWB" ]; then
  curl -s -b "$J" -X POST "$B/api/v1/fulfillment/scan-awb" -H 'Content-Type: application/json' \
    -d "{\"scannedCode\":\"$AWB\",\"confirmPicking\":true}" -o /tmp/sc2.json
  j "JSON.stringify({code:d.code,stockDeducted:d.stockDeducted,pesan:(d.message||'').slice(0,120)})" < /tmp/sc2.json
fi

echo "== 7. Rekonsiliasi dijalankan lagi (harus idempoten: 0 ditutup) =="
curl -s -b "$J" -X POST "$B/api/v1/fulfillment/reconcile-shipped" -H 'Content-Type: application/json' \
  -d '{"apply":true}' -o /tmp/rc2.json
j "JSON.stringify({perluDitutup:d.perluDitutup,ditutup:d.ditutup,unitStokDipotong:d.unitStokDipotong})" < /tmp/rc2.json
