# Runbook Operasional — E-Fulfill Hub

Catatan hal-hal yang **benar-benar pernah menggagalkan deploy/produksi**, lengkap
dengan cara memulihkannya. Ditulis dari kejadian nyata di VPS
`45.126.43.98` (`/opt/efulfill/app`, PM2 `efulfill`, port 3000).

---

## 1. Deploy

### Cara yang dipakai sekarang
Mesin pengembangan **tidak** memakai kunci SSH (kunci publiknya ditolak server),
jadi deploy memakai **password** lewat helper Paramiko:

```bash
# dari akar repo, isi password hanya lewat environment (tidak ditulis ke berkas)
VPS_PASS='...' uv run --with paramiko python scripts/vps-deploy-paramiko.py deploy
```

Yang dijalankan helper ini, berurutan, dalam **satu** koneksi:

1. buat tarball SEGAR `src` + `prisma` dari repo saat ini (sejak 2026-10-25;
   sebelumnya memakai `ef8.tgz` sisa di %TEMP% dan pernah me-roll-back kode
   produksi ke versi lama tanpa sadar) → unggah → ekstrak menimpa `/opt/efulfill/app`
2. `npx prisma migrate deploy`
3. `npx prisma generate`
4. `npm run build`
5. `pm2 restart efulfill --update-env`
6. `curl /login` → harus `HEALTH=200`

Verifikasi cepat (login + angka kartu + uji scan):

```bash
VPS_PASS='...' VPS_SCRIPT='verify-cancel-cards.sh' \
  uv run --with paramiko python scripts/vps-deploy-paramiko.py verify
```

### Cek kesehatan rutin

```bash
VPS_PASS='...' VPS_SCRIPT='vps-health.sh' \
  uv run --with paramiko python scripts/vps-deploy-paramiko.py verify
```

Menampilkan disk, jumlah & ukuran binlog, status PM2, health HTTP, status
migrasi, dan ukuran database — cukup satu perintah untuk memastikan server
sehat sebelum/sesudah deploy.

### Jangan mengandalkan `ssh`/`scp` biasa
Percobaan SSH beruntun bisa ditolak (`Permission denied (publickey,password)`)
walaupun koneksi TCP & host key normal. Itu pembatasan di server, bukan kunci
yang salah — berhenti mencoba berulang, pakai helper di atas.

---

## 2. Disk penuh = migrasi & build GAGAL dengan gejala menyesatkan

**Gejala:** `npx prisma migrate deploy` berhenti setelah `11 migrations found`
tanpa pesan error; build Next.js gagal; MySQL menjawab
`The table '/tmp/#sql...' is full`.

**Penyebab:** partisi `/` 100% penuh. MySQL butuh ruang untuk tabel sementara
saat `ALTER TABLE`, Next.js butuh ruang untuk `.next`.

**Cek & bersihkan (aman, tidak menyentuh data aplikasi):**

```bash
df -h /                                   # cek pemakaian
journalctl --vacuum-time=7d               # log sistem → 7 hari
journalctl --vacuum-size=200M
: > /var/log/nginx/access.log             # potong, jangan hapus
: > /var/log/nginx/error.log
pm2 flush
npm cache clean --force
rm -rf /opt/efulfill/app/.next/cache
```

---

## 3. Riwayat migrasi "gagal" padahal kolomnya sudah ada

Kalau migrasi terputus (disk penuh / koneksi mati), Prisma mencatat baris
**failed** (`finished_at NULL`) di `_prisma_migrations`. Selama baris itu ada,
semua migrasi berikutnya ditolak:

> `migrate found failed migrations in the target database, new migrations will not be applied.`

**Jangan** langsung `migrate resolve --rolled-back` kalau perubahan skema sudah
terlanjur masuk (bisa menjalankan ulang `ALTER TABLE` yang menabrak kolom).

Urutan yang benar:

```sql
-- 1. Pastikan perubahannya MEMANG sudah ada
SELECT COUNT(*) FROM information_schema.columns
 WHERE table_schema = DATABASE() AND table_name = 'orders'
   AND column_name IN ('cancel_by','cancel_reason','buyer_cancel_reason',
                       'cancel_requested_at','cancelled_at');   -- harus 5

-- 2. Ada baris selesai? (finished_at NOT NULL)
SELECT migration_name, finished_at FROM _prisma_migrations
 WHERE migration_name = '20261019170000_order_cancellation';

-- 3. Hapus HANYA baris gagal (percobaan yang tidak menghasilkan apa pun)
DELETE FROM _prisma_migrations
 WHERE migration_name = '20261019170000_order_cancellation'
   AND finished_at IS NULL AND rolled_back_at IS NULL;
```

Lalu `npx prisma migrate deploy` harus menjawab **“No pending migrations”** dan
`npx prisma migrate status` → **“Database schema is up to date!”**.

---

## 4. Aturan status pesanan (jangan dilanggar UI)

| Sumber | Arti |
|---|---|
| `orders.status` (NEW/CONFIRMED/CANCELLED/COMPLETED) | status internal, kasar |
| `orders.external_status` | status **mentah** Shopee (`READY_TO_SHIP`, `PROCESSED`, `IN_CANCEL`, …) |
| `shipments.status` | keberadaan paket (`PICKED_UP`, `IN_TRANSIT`, `DELIVERED`, …) |
| `fulfillment_orders.status` | pekerjaan gudang (bisa tertinggal dari kenyataan) |
| `orders.cancel_by` | `buyer` / `seller` / `system` / `Ops` |
| `orders.cancel_reason` | mis. `BACKEND_LOGISTICS_NOT_STARTED`, `Seller did not Ship`, `Unpaid Order` |

**Aturan emas:** keputusan yang menyangkut *paket* memakai `shipments.status`;
keputusan yang menyangkut *pekerjaan gudang* memakai `fulfillment_orders`.
Kalau keduanya bertentangan, paket yang menang — barangnya sudah keluar gudang.

---

## 5. Kalau operator melaporkan "scan resi minta tambah stok"

Penyebabnya selalu satu dari dua:

1. **Catatan fulfillment tertinggal** (paket sudah dikirim lewat Seller Centre,
   aplikasi belum pernah memacking). Perbaiki dengan tombol **“Tutup otomatis”**
   pada banner di halaman Pesanan, atau `POST /api/v1/fulfillment/reconcile-shipped
   {"apply":true}`. Aman diulang (idempoten, stok dipotong maksimal sekali).
2. **Stok varian memang belum pernah diisi** (varian `SHOPEE-…` hasil
   auto-register). Isi saldo awal di menu Inventori.

Sejak perbaikan `parcel-status.ts`, scan paket yang sudah dijemput/in-transit
**tidak pernah lagi** menyentuh stok: hasilnya `ALREADY_IN_TRANSIT` dengan
`stockDeducted: false`.

---

## 6. Migrasi VPS 2026-10-25 (103.178.174.224 → 45.126.43.98)

Produksi pindah ke VPS baru dengan cara: pasang dependensi identik (Node 22,
MySQL 8.4, Nginx, PM2+logrotate, ufw, WIB, binlog 2 hari) → salin
`/opt/efulfill/app` tanpa `node_modules`/`.next` → `mysqldump --single-transaction`
→ impor → build → sertifikat SSL baru untuk `45-126-43-98.sslip.io` → cutover
(stop app lama, dump final, impor, start app baru; downtime ±72 detik).
Verifikasi: 31/31 tabel jumlah baris identik. **VPS lama dipertahankan sebagai
cadangan** (app di-`pm2 stop`, MySQL hidup, data utuh).

Hal yang WAJIB dilakukan pemilik di **Shopee Open Platform Console** setelah
migrasi (tidak bisa lewat API):

1. **App list → IP Address Whitelist → tambah `45.126.43.98`.** Tanpa ini,
   panggilan ambil resi (`logistics/get_tracking_number`) ditolak dengan error
   `source_ip_undeclared` (terlihat di log error PM2). Sinkronisasi pesanan
   tetap jalan; yang gagal hanya endpoint yang dijaga whitelist.
2. Perbarui **Redirect URL** aplikasi ke
   `https://45-126-43-98.sslip.io/api/v1/integrations/shopee/callback`
   (untuk otorisasi ulang di masa depan; token lama tetap valid dan sudah
   ikut pindah terenkripsi di database).

Alamat produksi berubah menjadi `https://45-126-43-98.sslip.io` — pengguna
perlu login ulang (cookie lama terikat domain lama).

---

## 7. Domain sendiri `maktabah313.web.id` + Cloudflare (2026-10-25)

Nameserver domain dipindah dari NyanHosting (zona DNS mereka menolak
melayani — `Query refused`, record tidak pernah terbaca dunia luar) ke
**Cloudflare gratis** (`jonah/blair.ns.cloudflare.com`). Sertifikat Let's
Encrypt atas nama `maktabah313.web.id` + `www` terpasang di VPS dan
**perpanjangan otomatis** (`certbot renew --dry-run` sukses). Konfigurasi
Nginx domain ada di `/etc/nginx/sites-available/efulfill-domain` —
HATI-HATI: `certbot --nginx` pernah MENIMPA symlink `sites-enabled` dengan
file biasa sehingga config bersih di `sites-available` terabaikan; pastikan
`sites-enabled/efulfill-domain` tetap symlink. `www` dialihkan 301 ke
domain utama; `https://45-126-43-98.sslip.io` dipertahankan sebagai jalur
darurat.

SSE realtime aman lewat proxy Cloudflare karena aplikasi mengirim ping
tiap 25 detik (< batas idle ~100 detik Cloudflare). Mode SSL yang benar di
Cloudflare: **Full (strict)**.

Konsol Shopee hanya menerima Redirect URL berupa **domain utama**
(`https://maktabah313.web.id/`), bukan path `/api/v1/...`. Karena itu
`src/proxy.ts` meneruskan permintaan akar domain yang membawa `?code=...`
ke endpoint callback — tanpa itu kode otorisasi hilang di halaman depan.
`SHOPEE_REDIRECT_URL` (.env) dan `marketplace_app_configs.redirect_url`
(database) keduanya di-set ke domain utama agar cocok dengan konsol.

---

## 8. Pesanan batal ≠ "Gagal kirim" (migrasi 2026-10-28)

**Gejala yang dilaporkan pemilik toko:** pesanan yang dibatalkan muncul di
halaman **Lacak Kiriman** dengan status **Gagal kirim**, dan kartu pesanannya
memakai badge merah `Gagal kirim`.

**Akar masalahnya di data, bukan tampilan.** Fungsi `mapLogisticsStatus()`
dipakai untuk dua bahasa status yang berbeda: status **pesanan** dan status
**paket**. Akibatnya status pesanan `CANCELLED` ditulis ke `shipments.status`
sebagai `FAILED` pada setiap putaran sinkronisasi.

Perbaikannya:

- `ShipmentStatus` mendapat nilai baru `CANCELLED` (migrasi
  `20261028090000_shipment_cancelled_status`, aditif — tidak ada kolom berubah).
- Pemetaan pesanan→paket dipisah ke `src/modules/shipping/domain/shipment-status.ts`
  (`mapOrderStatusToShipment`), dan aturan "status hanya boleh maju" ikut pindah
  ke sana (`shouldAdvanceShipmentStatus`) supaya sinkronisasi, webhook, dan
  pembatalan memakai satu definisi.
- Sekalian ditutup: nomor resi yang datang **setelah** pesanan batal tidak lagi
  membuat baris pengiriman baru.

**Perbaikan data lama ikut di migrasi**, dengan batas yang ketat: hanya baris
`FAILED` milik pesanan `CANCELLED` yang **tidak punya** peristiwa pelacakan
`PICKED_UP` / `IN_TRANSIT` / `DELIVERED`. Paket yang nyata-nyata keluar gudang
lalu gagal diantar tetap `FAILED` — itu kenyataan yang tidak boleh dihapus.

Cara memeriksa setelah deploy (di VPS):

```sql
SELECT s.status, COUNT(*) FROM shipments s JOIN orders o ON o.id = s.order_id
WHERE o.status = 'CANCELLED' GROUP BY 1;
```

Yang diharapkan: `CANCELLED` untuk paket yang tidak pernah dijemput, dan tidak
ada lagi `FAILED` tanpa jejak perjalanan. Halaman Lacak Kiriman kini punya chip
**Gagal Kirim**, **Dikembalikan**, dan **Dibatalkan** yang terpisah — sebelumnya
`FAILED` tidak bisa disaring sama sekali.

Catatan operasional: pesanan yang dibatalkan **setelah** paket dijemput kurir
tidak diubah menjadi `CANCELLED`; paket seperti itu mengikuti jalur retur
(`RETURNED`), bukan pembatalan.

---

## 9. Catatan fulfillment otomatis (2026-10-28)

Dulu catatan fulfillment (antrean kerja gudang) hanya dibuat untuk pesanan
yang **baru diimpor** (`result.created`). Pesanan yang sudah ada di database
lalu berubah menjadi siap dikerjakan — mis. `UNPAID` menjadi `READY_TO_SHIP`
setelah pembeli membayar — tidak pernah mendapat catatan, sehingga:

- tidak muncul di antrean kerja halaman Pesanan,
- tidak ikut dihitung sebagai pekerjaan gudang,
- tidak masuk daftar produksi,

sampai seseorang menekan **"Proses ke Fulfillment"** secara manual.

Sekarang `ensureFulfillmentForOrder()` dipanggil oleh sinkronisasi **dan**
webhook setiap kali pesanan berstatus `CONFIRMED`. Keputusannya ada di domain
`fulfillment-gate.ts` dan sengaja **tidak** membuat catatan bila:

| Keadaan | Alasan |
|---|---|
| Pesanan `CANCELLED` | paketnya tidak akan pernah dikirim |
| Pesanan masih `NEW` / belum dibayar | belum jadi pekerjaan gudang |
| Paket sudah `PICKED_UP`/`IN_TRANSIT`/`DELIVERED`/`FAILED`/`RETURNED` | barang sudah keluar gudang |
| Sudah ada catatan aktif | idempoten |

Karena idempoten, aman dijalankan setiap putaran sinkronisasi (60 detik) tanpa
membuat catatan kembar. Kalau stok belum cukup, catatan tetap dibuat dengan
status `WAITING_STOCK` — itu memang pekerjaan yang menunggu stok, bukan
kegagalan.

