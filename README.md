# E-Fulfill Hub

ERP operasional gudang (fulfillment) untuk penjual Shopee: sinkronisasi pesanan real-time,
prioritas pengerjaan, picking & scanning, packing, pengiriman, retur/QC, dan buku besar stok —
dalam satu workspace.

Dibangun dengan **Next.js 16 (App Router) + React 19 + Prisma + MySQL 8 + TypeScript (strict)**.

---

## 1. Prasyarat

- **Node.js 20+** (dianjurkan 22 LTS)
- **MySQL 8.x** berjalan di `localhost:3306` (mis. Laragon, atau MySQL apa pun)
- `npm`

## 2. Setup lokal

```bash
# 1. Install dependensi
npm install

# 2. Siapkan database
#    Jalankan di MySQL:
#    CREATE DATABASE efulfillhub CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

# 3. Konfigurasi environment
cp .env.example .env.local
#    lalu isi DATABASE_URL dan generate JWT_SECRET + ENCRYPTION_KEY (lihat .env.example)

# 4. Migrasi + seed (seed membuat tenant, user, gudang, katalog, stok, toko Shopee)
npx prisma migrate dev
#    atau bila sudah ada migrasi:
npx prisma migrate reset --force   # reset + reseed

# 5. Jalankan
npm run dev
```

Buka `http://localhost:3000`.

## 3. Akun (dibuat oleh seed)

| Peran | Email | Password |
|---|---|---|
| Owner (admin) | `owner@toko.id` | `Owner12345` |
| Manager | `manager@toko.id` | `Manager12345` |
| Staff (gudang) | `staff@toko.id` | `Staff12345` |

> Tidak ada akun demo hardcoded di kode. Semua login memverifikasi ke database (bcrypt),
> sesi memakai cookie `httpOnly` (JWT), bukan `localStorage`.

## 4. Integrasi Shopee (Open Platform v2)

Sistem **sudah siap penuh** untuk integrasi nyata; tinggal isi kredensial.

1. Buka Shopee Open Platform Console, buat aplikasi, catat **Partner ID** & **Partner Key**.
2. Isi di `.env.local`:
   ```
   SHOPEE_PARTNER_ID="<partner_id>"
   SHOPEE_PARTNER_KEY="<partner_key>"
   SHOPEE_REDIRECT_URL="http://localhost:3000/api/v1/integrations/shopee/callback"
   SHOPEE_SANDBOX="true"          # untuk uji di sandbox dulu
   ```
3. Buka menu **Integrasi** → **Hubungkan via Shopee** (OAuth), atau **Input Kredensial Manual**.
4. **Tarik Pesanan Sekarang** untuk sinkronisasi manual; push/webhook untuk real-time.

Sampai akun partner Anda disetujui (review), seluruh alur tetap bisa diuji di **Sandbox**
(`SHOPEE_SANDBOX=true`). Referensi lengkap & terverifikasi: `08-INTEGRATION-SHOPEE.md` dan
`20-SHOPEE-API-REFERENCE.md`.

## 5. Perintah

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Dev server (hot reload) |
| `npm run build` | Build produksi |
| `npm start` | Jalankan build produksi |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest (unit) |
| `npx prisma migrate dev` | Terapkan migrasi |
| `npx prisma migrate reset --force` | Reset + reseed |
| `npx prisma studio` | GUI database |

## 6. Struktur (arsitektur modular / clean)

```
src/
  app/                 # Next.js App Router (halaman + API route)
    api/v1/            #   API internal (REST)
    dashboard/         #   Halaman workspace (dilindungi auth)
  modules/             # Domain modular (per fitur)
    <modul>/
      domain/          #   Entitas + state machine (murni, tanpa framework)
      application/     #   Use cases (orkestrasi)
      infrastructure/  #   Adapter eksternal (Shopee, Prisma)
  shared/              # Prisma client, error, envelope API
  lib/                 # Klien API + komponen UI bersama
  middleware.ts        # Auth cookie + proteksi rute + sanitasi header
prisma/
  schema.prisma        # Model data
  migrations/          # Riwayat migrasi
  seed.ts              # Seed data demo realistis
```

Aturan domain: modul tidak saling tahu detail internal; integrasi Shopee hanya hidup di
`integrations/infrastructure/` (ADR-002). Lihat `05-ARCHITECTURE.md`.

## 7. Dokumentasi

| Dokumen | Isi |
|---|---|
| `01-PRD.md` | Visi & cakupan produk |
| `04-DOMAIN-MODEL.md` | Entitas + state machine |
| `05-ARCHITECTURE.md` | Arsitektur modular |
| `06-DATA-MODEL.md` | Skema data |
| `07-API-CONTRACT.md` | Kontrak API internal (normatif) |
| `08-INTEGRATION-SHOPEE.md` | Desain integrasi Shopee (terverifikasi) |
| `09-FULFILLMENT-RULES.md` | Aturan prioritas & fulfillment |
| `10-SECURITY.md` | Model keamanan |
| `19-DESIGN-SYSTEM.md` | Design system (token warna/tipe, tanpa gradient/emoji) |
| `20-SHOPEE-API-REFERENCE.md` | Referensi mentah API Shopee v2 |
