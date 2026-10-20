#!/usr/bin/env bash
# Pemeriksaan akhir: memastikan tidak ada lagi paket yang sudah keluar gudang
# namun catatan fulfillment-nya tertinggal, dan badge menu konsisten.
set -uo pipefail
cd /opt/efulfill/app
B=http://127.0.0.1:3000
J=/tmp/final.txt
rm -f "$J"
curl -s -c "$J" -X POST "$B/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"owner@toko.id","password":"Owner12345"}' -o /dev/null

DBURL=$(grep '^DATABASE_URL' .env | cut -d= -f2- | tr -d '"')
DBUSER=$(echo "$DBURL" | sed -E 's#mysql://([^:]+):([^@]+)@.*#\1#')
DBPASS=$(echo "$DBURL" | sed -E 's#mysql://([^:]+):([^@]+)@.*#\2#')
DBNAME=$(echo "$DBURL" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')
q() { mysql -u"$DBUSER" -p"$DBPASS" "$DBNAME" -t -e "$1" 2>/dev/null; }

echo "== A. Badge menu vs kartu halaman =="
echo -n "badge: "; curl -s -b "$J" "$B/api/v1/orders/badge" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s).data;console.log(JSON.stringify({count:d.count,notQueued:d.notQueued,belumResi:d.belumResi,sudahResi:d.sudahResi}))})"

echo "== B. Paket yang sudah keluar gudang: status fulfillment sekarang =="
q "
select s.status as status_kirim, coalesce(fo.status,'(tanpa fulfillment)') as status_fulfillment, count(*) as jumlah
  from shipments s
  join orders o on o.id = s.order_id
  left join fulfillment_orders fo on fo.order_id = o.id
 where s.status in ('PICKED_UP','IN_TRANSIT','DELIVERED')
   and o.status <> 'CANCELLED'
 group by s.status, status_fulfillment
 order by jumlah desc;"

echo "== C. Sisa anomali (harus 0) =="
q "
select count(distinct o.id) as paket_jalan_catatan_tertinggal
  from shipments s
  join orders o on o.id = s.order_id
  join fulfillment_orders fo on fo.order_id = o.id
 where s.status in ('PICKED_UP','IN_TRANSIT','DELIVERED')
   and o.status <> 'CANCELLED'
   and fo.status in ('WAITING_STOCK','READY_TO_PICK','PICKING','PICKED','PACKING','PACKED','READY_TO_SHIP');"

echo "== D. Jejak audit penutupan otomatis =="
q "select action, count(*) as jumlah from audit_logs where action = 'reconcile_shipped_closed' group by action;"

echo "== E. Dampak stok: varian dengan saldo minus =="
q "
select count(*) as varian_minus, coalesce(sum(on_hand),0) as total_minus
  from inventory_balances where on_hand < 0;"
