#!/usr/bin/env bash
# Verifikasi Fase 8 di produksi:
#   1. pesanan batal TIDAK lagi tercatat sebagai pengiriman gagal
#   2. tidak ada sisa data lama yang masih salah
#   3. catatan fulfillment otomatis ikut terbentuk untuk pesanan siap kerja
set -uo pipefail
cd /opt/efulfill/app
B=http://127.0.0.1:3000
J=/tmp/v8.txt
rm -f "$J"

echo "== health & migrasi =="
curl -s -o /dev/null -w '  HEALTH=%{http_code}\n' "$B/login"
npx prisma migrate status 2>/dev/null | grep -iE "up to date|not yet been applied" | sed 's/^/  /'

# ── SQL: butuh kredensial dari .env (tidak dicetak) ──────────────────────────
DBURL=$(grep -m1 '^DATABASE_URL=' .env | sed 's/^DATABASE_URL=//; s/^"//; s/"$//')
DBUSER=$(printf '%s' "$DBURL" | sed -E 's#^mysql://([^:]+):.*#\1#')
DBPASS=$(printf '%s' "$DBURL" | sed -E 's#^mysql://[^:]+:([^@]*)@.*#\1#')
DBNAME=$(printf '%s' "$DBURL" | sed -E 's#^mysql://[^/]+/([^?]+).*#\1#')
q() { mysql -u"$DBUSER" -p"$DBPASS" "$DBNAME" -N -B -e "$1" 2>/dev/null; }

echo
echo "== [C5] status paket milik pesanan DIBATALKAN (seharusnya CANCELLED) =="
q "SELECT s.status, COUNT(*) FROM shipments s JOIN orders o ON o.id=s.order_id
   WHERE o.status='CANCELLED' GROUP BY 1 ORDER BY 2 DESC" | sed 's/^/  /'

echo "== [C5] sisa data lama salah: FAILED milik pesanan batal TANPA jejak perjalanan (target 0) =="
q "SELECT COUNT(*) FROM shipments s JOIN orders o ON o.id=s.order_id
   WHERE o.status='CANCELLED' AND s.status='FAILED'
     AND NOT EXISTS (SELECT 1 FROM shipment_events e WHERE e.shipment_id=s.id
                     AND UPPER(e.status) IN ('PICKED_UP','IN_TRANSIT','DELIVERED'))" | sed 's/^/  sisa=/'

echo "== [C5] paket gagal NYATA yang tetap FAILED (bukti tidak dilunakkan) =="
q "SELECT COUNT(*) FROM shipments s JOIN orders o ON o.id=s.order_id
   WHERE o.status='CANCELLED' AND s.status='FAILED'
     AND EXISTS (SELECT 1 FROM shipment_events e WHERE e.shipment_id=s.id
                 AND UPPER(e.status) IN ('PICKED_UP','IN_TRANSIT','DELIVERED'))" | sed 's/^/  tetap_FAILED=/'

echo "== [C6] pesanan siap kerja yang BELUM punya catatan fulfillment (target 0) =="
q "SELECT COUNT(*) FROM orders o
   WHERE o.status='CONFIRMED'
     AND NOT EXISTS (SELECT 1 FROM fulfillment_orders f WHERE f.order_id=o.id AND f.status NOT IN ('COMPLETED','EXCEPTION'))
     AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.order_id=o.id AND s.status IN ('PICKED_UP','IN_TRANSIT','DELIVERED','FAILED','RETURNED'))" | sed 's/^/  belum_ada_catatan=/'

echo
echo "== [API] Lacak Kiriman: sebaran status yang dilihat operator =="
curl -s -c "$J" -X POST "$B/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"owner@toko.id","password":"Owner12345"}' -o /dev/null
j() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);const d=o.data??o;console.log(eval(process.argv[1]))})" "$1"; }

total_of() { curl -s -b "$J" "$B/api/v1/shipments$1&pageSize=1" -o /tmp/v8-x.json; j 'd.pagination?d.pagination.total:(d.items||[]).length' < /tmp/v8-x.json; }

SEMUA=$(total_of '?')
printf '  %-22s total=%s\n' "(tanpa filter)" "$SEMUA"
for st in CANCELLED FAILED RETURNED; do
  printf '  %-22s total=%s\n' "status=$st" "$(total_of "?status=$st")"
done

# Nilai asing harus DIAJUKAN seperti tanpa filter, bukan membalas 0.
# Sebelum perbaikan, `?status=ALL` membalas total=0 padahal ada data — operator
# membacanya sebagai "data hilang".
ASING=$(total_of '?status=ALL')
printf '  %-22s total=%s (harus sama dengan tanpa filter)\n' "status=ALL" "$ASING"
if [ "$ASING" = "$SEMUA" ]; then echo "  → OK: nilai asing diabaikan, data tidak hilang"; else echo "  → GAGAL: nilai asing masih mengosongkan hasil"; fi

echo "== [API] kartu antrean kerja =="
curl -s -b "$J" "$B/api/v1/fulfillment/station?range=all&bucket=perluDiproses&pageSize=1" -o /tmp/v8-kartu.json
j "JSON.stringify(d.kartu)" < /tmp/v8-kartu.json | sed 's/^/  /'

echo
echo "== [C3] filter tahap (klik kartu ringkasan) =="
for t in perluProduksi siapDiambil sedangDipacking siapDiserahkan; do
  curl -s -b "$J" "$B/api/v1/fulfillment/station?range=all&bucket=semua&tahap=$t&pageSize=1" -o /tmp/v8-t.json
  printf '  %-16s total=%s\n' "$t" "$(j 'd.total??(d.orders||[]).length' < /tmp/v8-t.json)"
done
# Nilai tahap asing harus diabaikan, bukan mengosongkan daftar.
curl -s -b "$J" "$B/api/v1/fulfillment/station?range=all&bucket=semua&tahap=NGARANG&pageSize=1" -o /tmp/v8-t2.json
printf '  %-16s total=%s (harus sama dengan bucket=semua)\n' "NGARANG" "$(j 'd.total??(d.orders||[]).length' < /tmp/v8-t2.json)"

echo
echo "== [UI] halaman Lacak Kiriman benar-benar render =="
curl -s -b "$J" "$B/dashboard/pengiriman" -o /tmp/v8-pg.html -w '  HTTP=%{http_code}\n'
for teks in "Gagal Kirim" "Dikembalikan" "Dibatalkan"; do
  printf '  chip "%s" ada: %s\n' "$teks" "$(grep -c "$teks" /tmp/v8-pg.html)"
done
printf '  halaman error React: %s\n' "$(grep -c "couldn't load" /tmp/v8-pg.html)"
