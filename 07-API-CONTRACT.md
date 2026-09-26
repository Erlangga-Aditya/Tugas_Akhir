# Internal API Contract

> Dokumen ini **normatif** — isinya mencerminkan implementasi aktual di `src/app/api/v1/**`.
> Bila ada ketidaksesuaian, kode adalah sumber kebenaran dan dokumen ini harus diperbarui.

## 1. Prinsip

- URL berbasis sumber daya (resource-oriented).
- Envelope respons stabil (lihat §5).
- Validasi input di batas (Zod di route).
- **Otorisasi sebelum akses data** — semua route membaca konteks autentikasi dari
  cookie httpOnly `efh_session` (diverifikasi middleware), **bukan** dari header
  yang dikirim klien. Header `x-tenant-id` / `x-user-id` / `x-auth-context` dihapus
  middleware untuk mencegah pemalsuan (IDOR).
- Isolasi tenant di setiap query (`tenantId` selalu dari sesi, bukan input).
- Pagination untuk koleksi.
- Idempotensi untuk mutasi yang bisa di-retry (push/webhook + sinkronisasi).
- Tidak ada kebocoran skema provider eksternal.

## 2. Autentikasi

| Endpoint | Metode | Publik? | Keterangan |
|---|---|---|---|
| `/api/v1/auth/login` | POST | ✅ | Email+password → set cookie `efh_session` (httpOnly, JWT). |
| `/api/v1/auth/register` | POST | ✅ | Buat tenant + user OWNER + gudang + toko Shopee default. |
| `/api/v1/auth/logout` | POST | ✅ | Hapus cookie. |
| `/api/v1/auth/me` | GET | ❌ | Profil + tenant + role pengguna saat ini. |

Semua endpoint lain (kecuali yang ditandai Publik) mewajibkan cookie sesi valid.
Tanpa cookie: API → `401`, halaman `/dashboard` → redirect `307` ke `/login`.

## 3. Daftar endpoint

### Dashboard & Reporting
| Endpoint | Metode | Keterangan |
|---|---|---|
| `/api/v1/dashboard` | GET | Metrics operasional + distribusi prioritas. |

### Pesanan (Order)
| Endpoint | Metode | Keterangan |
|---|---|---|
| `/api/v1/orders` | GET | Daftar pesanan (`?status=&page=&pageSize=`). |
| `/api/v1/orders/{orderId}` | GET | Detail pesanan + riwayat status + penjelasan prioritas. |
| `/api/v1/orders/{orderId}/reserve` | POST | Body `{warehouseId}` → reserve stok + buat fulfillment order (idempoten). |

### Fulfillment
| Endpoint | Metode | Keterangan |
|---|---|---|
| `/api/v1/fulfillment/queue` | GET | Antrian kerja (`?status=&page=&pageSize=`). |
| `/api/v1/fulfillment/orders/{fulfillmentOrderId}/start-picking` | POST | `READY_TO_PICK → PICKING`. |
| `/api/v1/fulfillment/tasks/{taskId}/scan` | POST | Body `{scannedCode}` → validasi scan picking. |
| `/api/v1/fulfillment/orders/{fulfillmentOrderId}/pack` | POST | `PICKED → PACKED` (atau `PACKING → PACKED`). |
| `/api/v1/fulfillment/orders/{fulfillmentOrderId}/ready-to-ship` | POST | `PACKED → READY_TO_SHIP`. |
| `/api/v1/fulfillment/orders/{fulfillmentOrderId}/handover` | POST | Body `{carrier, awb}` → buat shipment + potong stok + konsumsi reservasi. |

### Inventori
| Endpoint | Metode | Keterangan |
|---|---|---|
| `/api/v1/inventory` | GET | Saldo stok (`?warehouseId=&search=&page=&pageSize=`). |
| `/api/v1/inventory/adjustments` | POST | Body `{warehouseId, variantId, quantityDelta, reason}` → ledger otomatis. |
| `/api/v1/inventory/movements` | GET | Buku besar pergerakan stok. |

### Retur
| Endpoint | Metode | Keterangan |
|---|---|---|
| `/api/v1/returns` | GET | Daftar retur. |
| `/api/v1/returns/{returnId}/receive` | POST | Tandai paket retur diterima. |
| `/api/v1/returns/{returnId}/qc` | POST | Body `{warehouseId, items:[{returnItemId,result}]}` → restok/rusak sesuai hasil QC. |

### Pengiriman
| Endpoint | Metode | Keterangan |
|---|---|---|
| `/api/v1/shipments` | GET | Daftar pengiriman + resi. |
| `/api/v1/shipments/{shipmentId}/events` | POST | Body `{status, carrierStatus, description}` → catat event tracking. |

### Konfigurasi (read)
| Endpoint | Metode | Keterangan |
|---|---|---|
| `/api/v1/warehouses` | GET | Daftar gudang tenant. |
| `/api/v1/shops` | GET | Daftar saluran penjualan tenant. |

### Integrasi Shopee
| Endpoint | Metode | Publik? | Keterangan |
|---|---|---|---|
| `/api/v1/integrations/shopee/status` | GET | ❌ | Status koneksi + kredensial partner. |
| `/api/v1/integrations/shopee/auth-url` | GET | ❌ | Bangun URL otorisasi Shopee (state anti-CSRF). |
| `/api/v1/integrations/shopee/callback` | GET | ✅ | OAuth callback: `?code=&shop_id=&state=` → tukar token + simpan. |
| `/api/v1/integrations/shopee/connect` | POST | ❌ | Input kredensial manual (token terenkripsi AES-256-GCM). |
| `/api/v1/integrations/shopee/sync` | GET | ❌ | Riwayat sinkronisasi. |
| `/api/v1/integrations/shopee/sync` | POST | ❌ | Body `{shopId}` → tarik pesanan dari Shopee. |
| `/api/v1/integrations/shopee/webhook` | POST | ✅ | Push Shopee — verifikasi signature HMAC hex atas raw body. |

> Webhook & callback **publik** (tanpa JWT) — pemanggilnya server Shopee. Verifikasi
> signature di dalam route, bukan mengandalkan autentikasi pengguna.

## 4. State machine (lihat `04-DOMAIN-MODEL.md`)

- `OrderStatus`: `NEW → CONFIRMED → COMPLETED` (atau `→ CANCELLED` di titik mana pun).
- `FulfillmentStatus` (terpisah, pipeline gudang):
  `WAITING_STOCK → READY_TO_PICK → PICKING → PICKED → (PACKING) → PACKED → READY_TO_SHIP → HANDED_OVER → COMPLETED`
  (+ `EXCEPTION` dapat dipicu dari `PICKING` / `PACKING`).
- `ReturnStatus`: `REQUESTED → IN_TRANSIT → RECEIVED → INSPECTION → RESTOCKED | DAMAGED | REJECTED | CLOSED`.

## 5. Envelope respons

Sukses:
```json
{
  "data": { "...": "..." },
  "meta": { "requestId": "...", "pagination": { "page": 1, "pageSize": 20, "total": 42, "totalPages": 3 } }
}
```

Koleksi list mengembalikan `data` = `{ "items": [...], "pagination": {...} }`.

Error:
```json
{
  "error": {
    "code": "STOCK_INSUFFICIENT",
    "message": "Stok tidak mencukupi untuk 1 SKU.",
    "details": { "failedSkus": ["KAOS-M"] }
  },
  "meta": { "requestId": "..." }
}
```

- `error.code` adalah kode bisnis yang stabil (mis. `NOT_FOUND`, `VALIDATION_ERROR`,
  `INVALID_STATE_TRANSITION`, `BUSINESS_RULE_VIOLATION`, `UNAUTHORIZED`, `CONFLICT`).
- **Jangan pernah** kembalikan stack trace ke klien.

## 6. Pagination

Offset-based (`page`, `pageSize`) untuk koleksi admin; cursor untuk antrian operasional
yang besar. Nilai `pageSize` dibatasi server (maks 100).

## 7. Idempotensi

- Push/webhook: kunci `(shop_id, provider, external_event_id)` di `webhook_events` — unik.
  Penerapan atomik (`create` + tangkap `P2002`), bukan cek-lalu-tulis.
- Order import: unik `(shop_id, external_order_id)` → tidak ada duplikat.
- Sinkronisasi: `SyncRun` mencatat `operation` + rentang waktu; rerun aman.
