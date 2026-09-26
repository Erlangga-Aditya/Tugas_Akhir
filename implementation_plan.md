# 📋 E-Fulfill Hub — Rencana Perbaikan Menyeluruh (System Overhaul)

> **STATUS: SUPERSEDED (2026-09-25) — jangan dipakai sebagai acuan implementasi.**
>
> Dokumen ini adalah rencana awal (analisis 7 masalah kritis + 6 masalah UX) yang
> **sudah dieksekusi**. Sebagian isinya sudah tidak sesuai kode sekarang, jadi
> dibaca sebagai catatan proses, bukan spesifikasi.
>
> Yang sudah berubah dan tidak lagi sesuai dokumen ini:
>
> | Topik | Kondisi lama (dokumen ini) | Kondisi sekarang |
> |---|---|---|
> | Halaman kerja | banyak halaman (scanner, fulfillment, picking) | **satu halaman** `/dashboard/pesanan`; halaman lama = redirect |
> | Scan | scan produk/SKU untuk picking | **hanya scan resi (AWB)**; tidak ada scan produk |
> | Pengurangan stok | di `handOverToCarrier()` | **satu pintu**: `completePacking()`; handover tidak pernah potong stok |
> | Kredensial Shopee | mustahil edit `.env` | diisi dari **UI** (menu "Hubungkan Shopee"), disimpan terenkripsi |
> | Nomor resi | (−) | aplikasi **tidak pernah membuat nomor resi**; gagal dilaporkan jujur |
> | Label | (−) | memakai **file resmi Shopee** (549→547→561→548), tidak digambar ulang |
>
> Dokumentasi yang lebih当前 dan harus jadi acuan:
> - `docs/riwayat-pengujian.md` — hasil pengujian yang benar-benar dijalankan
> - `11-TESTING.md` — strategi pengujian
> - `09-FULFILLMENT-RULES.md` — aturan stok & serah terima
>
> Teks di bawah dipertahankan sebagai arsip proses.

Dokumen ini adalah analisis penuh sistem dari sudut pandang **user flows** (dari pesanan masuk hingga paket dikirim kurir), beserta semua masalah yang ditemukan dan rencana perbaikannya.

---

## 🔍 Ringkasan Masalah yang Ditemukan

Setelah menelusuri seluruh kode (prisma schema, sync service, shopee adapter, semua page & API route), ditemukan **7 masalah kritis** dan **6 masalah UX/fungsional** yang harus diperbaiki.

---

## 🔴 MASALAH KRITIS

### 1. OAuth Hanya Bisa dengan Akun Sandbox — BUKAN Akun Seller Asli

**Akar masalah di `.env`:**
```
SHOPEE_SANDBOX="true"
```

Ini membuat `buildAuthUrl()` menggunakan `https://open.sandbox.test-stable.shopee.com/auth` — yang hanya menerima **akun sandbox Shopee**, BUKAN akun seller nyata.

**Dampak:** Tidak ada seller sungguhan yang bisa connect.

**Perbaikan yang direncanakan:**
- Saat OAuth flow dimulai, sistem deteksi mode dari `SHOPEE_SANDBOX` env
- Tambahkan setup wizard di halaman Integrasi: user bisa configure partner ID + partner key + mode (sandbox/production) **dari UI**, bukan edit `.env` manual
- Redirect URL (`SHOPEE_REDIRECT_URL`) harus **auto-detect** dari `request.url` saat callback masuk, bukan hardcode
- Setelah auth berhasil, flag `sandbox` di `IntegrationConnection` ikut disimpan

---

### 2. Scanner Salah Target — Scan Produk, Bukan Scan Resi

**Masalah di `scanner/page.tsx`:**
- Scanner hanya menangani **barcode produk / SKU** untuk picking task
- Tidak ada fitur **scan resi (AWB/tracking number)** untuk konfirmasi paket siap kirim

**Flow yang benar:**
1. **Scan produk/SKU** → picking verification (sudah ada)
2. **Scan resi/AWB** → konfirmasi packing selesai + paket siap kirim (BELUM ADA)

**Perbaikan:**
- Tambahkan **mode kedua di Scanner**: "Scan Resi / AWB"
- Ketika AWB di-scan: cari order → tandai PACKED → kurangi stok gudang → tampilkan konfirmasi

---

### 3. Stok Tidak Berkurang Saat Packing

**Masalah di `fulfillment.usecase.ts`:**
- `completePacking()` hanya ubah status ke `PACKED`, **tidak kurangi stok**
- Pengurangan stok baru terjadi di `handOverToCarrier()` (step HANDED_OVER)
- Tidak sesuai realita: "saat dipacking itu berarti stok berkurang"

**Perbaikan:**
- Pindahkan logika deduction stok ke `completePacking()`
- Saat packing done → semua item dikurangkan stok-nya secara atomik
- Consume `StockReservation` (ubah ke `CONSUMED`)

---

### 4. Halaman Pesanan: Tidak Ada Detail View + Tidak Ada Kolom Resi

**Masalah di `pesanan/page.tsx`:**
- Hanya menampilkan tabel list — **tidak ada klik untuk lihat detail pesanan**
- Tidak tampil resi (AWB) sama sekali
- User tidak bisa tahu produk apa yang dipesan, qty, alamat kirim, apakah sudah ada resi

**Perbaikan:**
- Buat halaman detail `pesanan/[orderId]/page.tsx`
- Tampilkan kolom "Resi" di tabel — AWB jika sudah ada, "Belum Ada Resi" jika belum
- `listOrders()` harus include `shipments` di response

---

### 5. Tidak Ada Badge Notifikasi Pesanan di Sidebar

**Masalah di `layout.tsx`:**
- Menu "Pesanan" tidak memiliki badge count
- User tidak tahu ada pesanan baru tanpa buka halaman pesanan

**Perbaikan:**
- Badge di sidebar item "Pesanan": jumlah pesanan `CONFIRMED` belum diproses
- Badge auto-update setiap auto-sync / webhook masuk
- Animasi pulse jika ada pesanan baru < 5 menit

---

### 6. Real-time Sync Terlalu Lambat (Polling 3 Menit)

**Masalah di `AutoSyncStatus.tsx`:**
```ts
intervalId = setInterval(() => {
  performSync(activeShopId, true);
}, 180000); // 3 menit!
```

- Webhook Shopee sudah ada (`/api/v1/integrations/shopee/webhook`), tapi **UI tidak tahu ketika webhook masuk**
- `shopee:synced` hanya dispatch setelah polling selesai, bukan realtime

**Perbaikan:**
- Implementasikan **Server-Sent Events (SSE)** endpoint: `/api/v1/events/stream`
- Setiap kali webhook diproses → server push event ke semua client
- Client subscribe ke SSE → update UI **instant** tanpa polling
- Fallback: polling 60 detik

---

### 7. Auto-sync Menjalankan Full Sync (Berat) Setiap Siklus

**Masalah:**
- `sync-all` = sync produk + pesanan + tracking + return — **sangat berat** untuk tiap 3 menit
- Sync produk tidak perlu setiap siklus

**Perbaikan:**
- Buat endpoint ringan `/api/v1/integrations/shopee/sync-light` (hanya orders + tracking)
- Background polling gunakan endpoint ringan
- Full sync hanya dipanggil manual atau saat pertama kali koneksi

---

## 🟡 MASALAH UX/FUNGSIONAL

### 8. Detail Produk di Pesanan Tidak Terlihat
`listOrders()` hanya return `itemCount`. Perbaikan: expandable row atau modal detail.

### 9. Verifikasi Stok Tidak Transparan
Jika stok kurang → `WAITING_STOCK`, tapi user tidak tahu produk mana shortfall-nya. Perbaikan: tampilkan detail shortfall di halaman fulfillment.

### 10. Setup Integrasi Wajib Edit `.env` Manual
Tidak scalable untuk seller lain. Perbaikan: form konfigurasi Partner ID + Partner Key di UI.

### 11. Pesanan yang Dilewati (Unmapped SKU) — Silent Failure
Jika Shopee kirim pesanan tapi produk belum sync → dilewati tanpa notifikasi. Perbaikan: alert di dashboard + counter pesanan dilewati.

### 12. Scanner AWB Tidak Tahu Pesanan Mana
Scan AWB → auto-lookup order di DB → auto-select. Jika tidak ditemukan, tampilkan error jelas.

### 13. Multi-Shop Tidak Fleksibel
UI selalu ambil shop pertama. Perbaikan: tampilkan semua shop + tombol "Tambah Toko".

---

## 📋 RENCANA IMPLEMENTASI (URUTAN PRIORITAS)

### FASE 1: Foundation & Auth Fix

#### 1A. Fix OAuth Production Mode
- [`shopee.adapter.ts`](file:///d:/jhe/E-fullhub/src/modules/integrations/infrastructure/shopee.adapter.ts) — sudah benar secara logika, env yang perlu diubah
- [`callback/route.ts`](file:///d:/jhe/E-fullhub/src/app/api/v1/integrations/shopee/callback/route.ts) — auto-detect redirect URL
- [`integrasi/page.tsx`](file:///d:/jhe/E-fullhub/src/app/dashboard/integrasi/page.tsx) — indikator sandbox/production

#### 1B. SSE Real-time Push
- **[NEW]** `src/app/api/v1/events/stream/route.ts` — SSE endpoint
- **[NEW]** `src/lib/sse.ts` — shared EventEmitter broadcast utility
- **[MODIFY]** `sync.service.ts` — dispatch SSE event setelah webhook diproses
- **[MODIFY]** `AutoSyncStatus.tsx` — subscribe SSE, fallback polling 60 detik

---

### FASE 2: Scanner Overhaul — AWB Scan Mode

- **[MODIFY]** `scanner/page.tsx` — tambah mode "Scan Resi/AWB"
- **[NEW]** `src/app/api/v1/fulfillment/scan-awb/route.ts` — scan AWB → lookup order + trigger packing
- **[MODIFY]** `fulfillment.usecase.ts` — pindahkan stock deduction ke `completePacking()`

---

### FASE 3: Halaman Pesanan — Detail + Resi + Badge

- **[MODIFY]** `pesanan/page.tsx` — kolom resi, expandable rows/detail button
- **[NEW]** `pesanan/[orderId]/page.tsx` — halaman detail pesanan lengkap
- **[MODIFY]** `order.usecase.ts` — include shipments (AWB) di `listOrders()`
- **[MODIFY]** `layout.tsx` — badge count di sidebar
- **[NEW]** `src/app/api/v1/orders/badge/route.ts` — lightweight count endpoint

---

### FASE 4: Auto-sync Optimization

- **[MODIFY]** `AutoSyncStatus.tsx` — ganti ke sync ringan + kurangi interval
- **[NEW]** `src/app/api/v1/integrations/shopee/sync-light/route.ts` — lightweight sync

---

### FASE 5: Unmapped SKU Alert & UX Fixes

- **[MODIFY]** `sync.service.ts` — simpan skipped order info
- **[MODIFY]** `integrasi/page.tsx` — tampilkan alert + counter SKU tidak ter-mapping

---

## 🔄 ALUR FULFILLMENT YANG BENAR (POST-PERBAIKAN)

```
[Shopee Order Masuk]
        ↓ (webhook code 3: order_status_push — REALTIME via SSE)
[DB: Order CONFIRMED] ←──── Otomatis
        ↓
[🔴 Badge muncul di sidebar "Pesanan"]
        ↓
[User buka halaman Pesanan]
  → List pesanan + kolom "Resi" (AWB atau "Belum Ada Resi")
  → Expandable: lihat detail produk, qty, SKU
  → Status fulfillment terlihat
        ↓
[Sistem otomatis cek stok gudang]
  → Cukup → FulfillmentOrder: READY_TO_PICK
  → Kurang → FulfillmentOrder: WAITING_STOCK (tampil shortfall)
        ↓
[User buka halaman Fulfillment]
  → Klik "Mulai Picking" → status: PICKING
        ↓
[User buka Scanner — MODE PICKING]
  → Scan barcode produk satu per satu
  → Checklist item terpenuhi semua
  → Status: PICKED
        ↓
[User buka Scanner — MODE SCAN RESI] ← FITUR BARU
  → Scan AWB dari stiker label Shopee
  → Sistem lookup order via AWB
  → Konfirmasi packing done
  → ✅ STOK BERKURANG untuk semua produk pesanan ini
  → Status: PACKED → READY_TO_SHIP
        ↓
[Kurir datang / user antar ke dropoff]
  → Klik "Serah Terima Kurir (Handover)"
  → Status: HANDED_OVER
        ↓
[Webhook code 4: order_trackingno_push]
  → AWB otomatis update di Shipment
  → Halaman pesanan update otomatis (via SSE — INSTANT)
```

---

## ⚠️ Open Questions

> [!IMPORTANT]
> **Q1 — Kapan tepatnya stok berkurang?**
> - **(A) Saat packing selesai dikonfirmasi** (sesuai request: "saat dipacking stok berkurang") ← REKOMENDASI
> - (B) Saat scan resi AWB
> - (C) Saat handover ke kurir (kondisi saat ini di kode)

> [!IMPORTANT]
> **Q2 — Real-time mechanism?**
> - **(A) SSE (Server-Sent Events)** — one-way push, mudah, tidak perlu infra tambahan ← REKOMENDASI
> - (B) WebSocket — bi-directional, butuh library tambahan
> - (C) Polling tiap 30 detik — paling mudah, tapi kurang "realtime"

> [!IMPORTANT]
> **Q3 — Shopee OAuth: Production atau Sandbox?**
> - Saat ini: `SHOPEE_SANDBOX="true"` → sandbox only
> - Untuk akun seller asli: perlu `SHOPEE_SANDBOX="false"` + partner app di-approve Shopee
> - **Apakah partner app Anda sudah live/production di Shopee Open Platform Console?**

> [!NOTE]
> **Q4 — Format Scanner Resi**
> Scan resi Shopee, apakah user mau scan:
> - AWB langsung (nomor resi dari stiker, contoh: `SPXID99999`)
> - Order SN (nomor pesanan Shopee, contoh: `250923XXXXXXXX`)
> - Keduanya bisa (sistem coba keduanya)?

---

## 📁 File yang Akan Dimodifikasi / Dibuat

### Dimodifikasi
| File | Perubahan |
|------|-----------|
| [`layout.tsx`](file:///d:/jhe/E-fullhub/src/app/dashboard/layout.tsx) | Tambah badge pesanan di sidebar |
| [`pesanan/page.tsx`](file:///d:/jhe/E-fullhub/src/app/dashboard/pesanan/page.tsx) | Kolom resi, expandable rows, detail view |
| [`scanner/page.tsx`](file:///d:/jhe/E-fullhub/src/app/dashboard/scanner/page.tsx) | Tambah mode scan AWB resi |
| [`integrasi/page.tsx`](file:///d:/jhe/E-fullhub/src/app/dashboard/integrasi/page.tsx) | Setup wizard, sandbox indicator, unmapped SKU alert |
| [`AutoSyncStatus.tsx`](file:///d:/jhe/E-fullhub/src/components/AutoSyncStatus.tsx) | SSE integration, lighter sync |
| [`sync.service.ts`](file:///d:/jhe/E-fullhub/src/modules/integrations/application/sync.service.ts) | SSE dispatch setelah webhook |
| [`fulfillment.usecase.ts`](file:///d:/jhe/E-fullhub/src/modules/fulfillment/application/fulfillment.usecase.ts) | Pindahkan stock deduction ke completePacking |
| [`callback/route.ts`](file:///d:/jhe/E-fullhub/src/app/api/v1/integrations/shopee/callback/route.ts) | Auto-detect redirect URL |
| [`order.usecase.ts`](file:///d:/jhe/E-fullhub/src/modules/orders/application/order.usecase.ts) | Include AWB/shipment di list response |

### Dibuat Baru
| File | Fungsi |
|------|--------|
| `src/app/api/v1/events/stream/route.ts` | SSE endpoint untuk real-time push |
| `src/lib/sse.ts` | SSE broadcast utility |
| `src/app/api/v1/fulfillment/scan-awb/route.ts` | Scan AWB → lookup order + trigger packing |
| `src/app/api/v1/orders/badge/route.ts` | Badge count pesanan baru |
| `src/app/api/v1/integrations/shopee/sync-light/route.ts` | Lightweight sync (orders + tracking only) |
| `src/app/dashboard/pesanan/[orderId]/page.tsx` | Halaman detail pesanan |

---

## ✅ Rencana Verifikasi

### Automated
```bash
npm run build  # pastikan tidak ada TypeScript error
```

### Manual Verification Flow
1. **OAuth Test**: Klik "Otorisasi Toko" → halaman Shopee terbuka dengan mode yang benar (sandbox/production)
2. **Real-time Test**: Buat pesanan di Shopee → muncul di dashboard dalam < 10 detik via webhook SSE
3. **Badge Test**: Pesanan baru → badge merah muncul di sidebar menu "Pesanan"
4. **Detail Pesanan**: Klik pesanan → lihat produk, qty, SKU, status resi
5. **Scanner AWB**: Scan resi → order ditemukan → stok berkurang
6. **Stok Berkurang**: Cek inventori setelah packing — stok harus berkurang sesuai qty pesanan
7. **End-to-end**: Pesanan masuk → picking → packing → scan resi → stok berkurang → handover
