# Runbook Operasional — E-Fulfill Hub

Catatan hal-hal yang **benar-benar pernah menggagalkan deploy/produksi**, lengkap
dengan cara memulihkannya. Ditulis dari kejadian nyata di VPS
`103.178.174.224` (`/opt/efulfill/app`, PM2 `efulfill`, port 3000).

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

1. unggah `src` + `prisma` (tar) → ekstrak menimpa `/opt/efulfill/app`
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
