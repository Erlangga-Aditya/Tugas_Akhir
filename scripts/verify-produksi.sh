#!/usr/bin/env bash
# Verifikasi: halaman Produksi (pilih + cetak), PDF ringkas, dan pengosongan stok.
set -uo pipefail
cd /opt/efulfill/app
B=http://127.0.0.1:3000
J=/tmp/vp.txt
rm -f "$J"
curl -s -c "$J" -X POST "$B/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"owner@toko.id","password":"Owner12345"}' -o /dev/null

echo "== 1. daftar produksi (JSON): urutan SET dulu lalu jilid =="
curl -s -b "$J" "$B/api/v1/fulfillment/production-list" -o /tmp/pl.json -w "  HTTP %{http_code}\n"
node -e "
const d=JSON.parse(require('fs').readFileSync('/tmp/pl.json','utf8')).data||{};
console.log('  pesanan:', d.totalPesanan, '| unit:', d.totalUnit);
for (const g of (d.grup||[]).slice(0,10)) console.log('   -', g.nama, '|', g.totalUnit, 'pcs |', g.pesanan.length, 'pesanan');
" 2>/dev/null || head -c 200 /tmp/pl.json

echo "== 2. PDF hanya pesanan terpilih =="
IDS=$(node -e "
const d=JSON.parse(require('fs').readFileSync('/tmp/pl.json','utf8')).data||{};
const ids=[]; for(const g of (d.grup||[])) for(const p of g.pesanan){ if(ids.length<3) ids.push(p.orderId); }
console.log(JSON.stringify(ids));" 2>/dev/null)
echo "  dipilih: $IDS"
curl -s -b "$J" -X POST "$B/api/v1/fulfillment/production-list" \
  -H 'Content-Type: application/json' -d "{\"orderIds\":$IDS}" -o /tmp/psel.pdf -D /tmp/psel.head -w "  HTTP %{http_code}\n"
grep -i "content-type\|content-disposition" /tmp/psel.head | sed 's/^/  /'
echo "  ukuran PDF terpilih: $(wc -c < /tmp/psel.pdf) byte"

echo "== 3. pengosongan stok (diminta owner) =="
curl -s -b "$J" -X POST "$B/api/v1/inventory/reset-all" -H 'Content-Type: application/json' \
  -d '{"notes":"Kosongkan stok awal oleh owner"}' -o /tmp/reset.json -w "  HTTP %{http_code}\n"
head -c 260 /tmp/reset.json; echo

echo "== 4. stok setelah dikosongkan =="
curl -s -b "$J" "$B/api/v1/catalog/products?pageSize=50" -o /tmp/prod.json
node -e "
const d=JSON.parse(require('fs').readFileSync('/tmp/prod.json','utf8'));
const items=d.data?.items||d.items||[];
let bukanNol=0, total=0;
for(const p of items) for(const v of (p.variants||[])){ total++; const oh=v.stock?.onHand??0; if(oh!==0) bukanNol++; }
console.log('  varian diperiksa:', total, '| stok bukan 0:', bukanNol);
" 2>/dev/null || echo "  (gagal membaca katalog)"

echo "== 5. kartu pesanan tetap sehat =="
curl -s -b "$J" "$B/api/v1/fulfillment/station?range=all&bucket=perluDiproses" -o /tmp/st.json -w "  HTTP %{http_code}\n"
node -e "
const d=JSON.parse(require('fs').readFileSync('/tmp/st.json','utf8')).data||{};
console.log('  kartu:', JSON.stringify(d.kartu), '| anomali:', JSON.stringify(d.anomali));
" 2>/dev/null || head -c 150 /tmp/st.json
