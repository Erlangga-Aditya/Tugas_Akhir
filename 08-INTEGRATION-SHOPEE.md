# Shopee Integration Design — VERIFIED

> **Status dokumen ini: NORMATIF dan BERISI FAKTA TERVERIFIKASI.**
> Versi sebelumnya (`## 7. Verification gates BEFORE implementation`) hanya berisi daftar `TBD`.
> Karena tidak ada fakta yang mengikat, implementasi akhirnya diisi `SimulatedShopeeAdapter`
> (data karangan). Dokumen ini menutup celah itu: semua fakta di bawah **diambil dari dokumentasi
> resmi Shopee Open Platform v2** dan ditandai status verifikasinya.
>
> **Tanggal verifikasi:** 2026-09-17 · **Sumber:** `open.shopee.com` (doc API internal SPA,
> `document_id` dicantumkan per klaim) · **Referensi mentah lengkap:** `20-SHOPEE-API-REFERENCE.md`
> (49 endpoint, 34 push code, 10 developer guide — hasil tarikan mentah, bukan ringkasan).
>
> **Aturan dokumen ini:** setiap klaim wajib punya salah satu label:
> `✅ VERIFIED` (ada di dok resmi, sumber dicantumkan) · `⚠️ PARSIAL` ·
> `❌ TIDAK ADA` (sudah dicek dan memang tidak ada) · `🔵 TBD` (belum diverifikasi — **dilarang diimplementasikan**).

## 1. Batasan & keputusan lingkup

- **Satu-satunya provider yang diimplementasikan: Shopee.** Tokopedia dan TikTok Shop
  **dihapus** dari UI dan tidak dibuatkan adapter. (Sebelumnya `integrasi/page.tsx:160-194`
  menampilkan kartu "Segera Hadir" untuk keduanya — janji tanpa implementasi.)
- Domain internal **tetap independen** dari skema Shopee (ADR-002). Shopee hanya boleh muncul di
  `integrations/infrastructure/`. Dilarang `import` tipe Shopee di `domain/` atau `application/`.
- `MarketplaceAdapter` (`integrations/domain/marketplace.adapter.ts`) dipertahankan sebagai seam,
  tetapi dipangkas ke kapabilitas yang **benar-benar dipakai** (lihat §6). Metode yang tidak punya
  pemanggil dihapus dari interface agar tidak menjadi janji kosong.

## 2. Kredensial yang harus diisi pengguna

Tidak ada satu pun nilai di bawah ini yang boleh ada di dalam kode. Semua lewat `.env` (server-only)
atau tabel `integration_connections` (terenkripsi).

| Variabel | Wajib | Keterangan |
|---|---|---|
| `SHOPEE_PARTNER_ID` | ✅ | int, diberikan saat registrasi partner |
| `SHOPEE_PARTNER_KEY` | ✅ | **rahasia**, dipakai untuk HMAC semua request & verifikasi push |
| `SHOPEE_REDIRECT_URI` | ✅ | harus **domain-nya terdaftar** di Console Shopee (Live & Test terpisah) |
| `SHOPEE_ENV` | ✅ | `sandbox` \| `live` — menentukan host (§5) |
| `SHOPEE_PUSH_CALLBACK_URL` | ✅ | URL publik yang didaftarkan sebagai callback push |
| `ENCRYPTION_KEY` | ✅ | 32-byte hex, untuk enkripsi `access_token`/`refresh_token` di DB |

Per-shop (`integration_connections`, terenkripsi at rest): `access_token`, `refresh_token`,
`access_token_expires_at`, `refresh_token_expires_at`, `external_shop_id`.

> Token disimpan **terpisah per `shop_id`** — ini diwajibkan dok resmi, bukan pilihan desain.

## 3. Alur otorisasi ✅ VERIFIED

Sumber: `document_id=20` "Authorization and Authentication".
Dok resmi menyebut **3 langkah** (bukan 6): (1) buat authorization link, (2) shop memberi otorisasi,
(3) ambil & refresh token. Langkah 3.3–3.5 di bawah adalah rincian langkah (3).

**3.1 Authorization link** — URL tetap, **bukan** `/api/v2/shop/auth_partner`:

| Environment | URL |
|---|---|
| Production (global) | `https://open.shopee.com/auth` |
| Sandbox (global) | `https://open.sandbox.test-stable.shopee.com/auth` |

Query wajib: `partner_id`, `auth_type` (`seller`), `redirect_uri`, `response_type=code`;
opsional `state` (anti-CSRF — **wajib kami pakai** dan diverifikasi saat callback).

- Link otorisasi ini memakai `timestamp`+`sign` yang **kedaluwarsa dalam 5 menit** → generate saat diklik, jangan di-cache.
- `redirect_uri` divalidasi terhadap "Redirect URL Domain" di Console; mismatch → error eksplisit.
- Akun **sub-account tidak bisa** login ke halaman otorisasi.
- Seller memilih masa otorisasi 7/30/90/180/365 hari (maks 365).

**3.2 Redirect balik** → `https://open.shopee.com/?code=xxxx&shop_id=xxxx`
- `code` **sekali pakai, kedaluwarsa 10 menit**.

**3.3 Tukar code → token** `POST /api/v2/auth/token/get`
- Common params di **query**: `partner_id`, `timestamp`, `sign`
- Body JSON: `code`, `partner_id`, dan **salah satu** `shop_id` atau `main_account_id`
- Response: `access_token`, `refresh_token`, `expire_in`, `request_id`, `error`, `message`

**3.4 Refresh** `POST /api/v2/auth/access_token/get`
- Query: `partner_id`, `timestamp`, `sign` · Body: `refresh_token`, `partner_id`, `shop_id`

**3.5 Masa berlaku ✅**

| Item | Masa berlaku |
|---|---|
| `access_token` | **4 jam** (`expire_in: 14400`), boleh dipakai berulang |
| `refresh_token` | **30 hari**, **sekali pakai** (setiap refresh menerbitkan refresh_token baru) |
| `code` | 10 menit, sekali pakai |
| `timestamp` request | 5 menit |
| Masa otorisasi maksimum | **365 hari** |
| access_token lama setelah refresh | masih valid 5 menit |

> Refresh token **wajib dipanggil di dalam masa otorisasi**. Karena `refresh_token` sekali pakai,
> penyimpanan token harus atomik: `refresh_token` baru yang gagal disimpan = integrasi mati.

**3.6 Batalkan otorisasi** — URL tetap `https://open.shopee.com/cancel_auth`.

## 4. Signature ✅ VERIFIED — dan koreksi penting

### 4.1 Sign request API

Base string = konkatenasi **tanpa separator**, urutan **wajib**:

| Tipe | base_string |
|---|---|
| **Shop API** | `partner_id` + `api_path` + `timestamp` + `access_token` + `shop_id` |
| **Merchant API** | `partner_id` + `api_path` + `timestamp` + `access_token` + `merchant_id` |
| **Public API** | `partner_id` + `api_path` + `timestamp` ← `access_token` & `shop_id` **DIOMIT** |

- `api_path` = path **tanpa host**, contoh `/api/v2/order/get_order_list`.
- Contoh resmi: base string `2001887/api/v2/shop/get_shop_info165571443159777174636562737266615546704c6d14701711`
  → `sign=56f31d01aeda9d08bf456b37f6f6640ef8614b4d6ad49baafe30b39a061f0e26`
- Algoritma: `HMAC-SHA256(base_string, partner_key)` → **hex huruf kecil**.
- ✅ Terkonfirmasi: untuk Public API (`auth/token/get`, `auth/access_token/get`, `push/*`),
  `access_token` dan `shop_id` **memang diomit** dari base string.

### 4.2 Sign push/webhook — ⚠️ **HEX, BUKAN base64**

Sumber: `document_id=18` "Push Mechanism". Kutipan dok resmi (verbatim, dari dump mentah):

> *"1. Use URL, |, response.content as the signature base string."*
> *"Note that the json.loads(response.content) method is not recommended"*
> *"3. Use the signature base string and partner key to generate the signature with the
> HMAC-SHA256 hashing algorithm. The output of the HMAC signature function is a binary string.
> This requires **hex encoding** to generate the signature string."*

- Base string: `url + "|" + <raw request body bytes>`
- Algoritma: `HMAC-SHA256(base_string, partner_key)` → **hex lowercase** (kode resmi memakai
  `hexdigest()` di Python, `%x` di Go, `Hex.encodeHexString` di Java).
- Nilai dikirim di header HTTP **`Authorization`**.
- ⚠️ **Wajib baca raw body**, jangan parse JSON lalu re-serialize — pemformatan ulang akan
  mengubah byte dan verifikasi gagal.

> ❌ Asumsi umum `base64(HMAC-SHA256(...))` **SALAH** untuk Shopee. Implementasi yang memakai
> base64 akan menolak **100% push yang sah**.

## 5. Host & format request ✅ VERIFIED

Sumber: `document_id=16` + `GET /opservice/api/v1/config/host`.

```
Production : https://partner.shopeemobile.com          ← yang kami pakai (global, deploy dekat SG)
Sandbox    : https://openplatform.sandbox.test-stable.shopee.sg
             https://partner.test-stable.shopeemobile.com
```

- Hanya **GET** dan **POST**. Content-Type `application/json`.
- **GET**: common params + request params **semua di query string**.
- **POST**: common params di **query string**, request params di **body JSON**.
- Common params Shop API: `partner_id`, `timestamp`, `sign`, `access_token`, `shop_id`.
- Format path: `/api/v2/{module}/{action}`.
- Envelope response: `{ request_id, error, message, warning?, response }`.
  **`error` kosong = sukses.** `request_id` **selalu** disimpan ke log/observability.
- ✅ Tidak ada `Idempotency-Key` di Shopee. Idempotensi murni tanggung jawab kami (§9).

## 6. Kapabilitas yang dipakai (dan yang tidak)

Semua path ✅ VERIFIED. Base produksi + path. **POST** kecuali dicatat.

### 6.1 Yang DIPAKAI

| Kebutuhan internal | Endpoint Shopee | Param kunci |
|---|---|---|
| Tarik pesanan | `v2.order.get_order_list` | `time_range_field`, `time_from`, `time_to`, `page_size`, `cursor`, `order_status`, `response_optional_fields` |
| Detail pesanan | `v2.order.get_order_detail` | `order_sn_list` (maks 50, koma) |
| Daftar paket/kiriman | `v2.order.get_shipment_list` | `page_size` 1–100, `cursor` |
| Cek metode pengiriman | `v2.logistics.get_shipping_parameter` | `order_sn` |
| **Atur pengiriman** | `v2.logistics.ship_order` | `order_sn` (+`package_number`, `pickup`, `dropoff`) |
| Nomor resi/AWB | `v2.logistics.get_tracking_number` | `order_sn`, `response_optional_fields=tracking_number` |
| Riwayat tracking | `v2.logistics.get_tracking_info` | `order_sn` (+`package_number`) |
| Cetak label | `v2.logistics.create_shipping_document` → `get_shipping_document_result` → `download_shipping_document` | `order_list` |
| Daftar kanal kurir | `v2.logistics.get_channel_list` | — |
| Tarik produk | `v2.product.get_item_list` | `offset`, `page_size` (maks 100), `item_status` |
| Info produk | `v2.product.get_item_base_info` | `item_id_list` (maks 50) |
| Daftar varian/model | `v2.product.get_model_list` | `item_id` |
| **Push stok ke Shopee** | `v2.product.update_stock` | `item_id`, `stock_list` (1–50) |
| Daftar retur | `v2.returns.get_return_list` | `page_no`, `page_size` ≤100 |
| Detail retur | `v2.returns.get_return_detail` | `return_sn` |
| Konfirmasi retur | `v2.returns.confirm` | `return_sn` |
| Tracking retur | `v2.returns.get_reverse_tracking_info` | `return_sn` |
| Konfigurasi push | `v2.push.set_app_push_config` | `callback_url`, `set_push_config_on/off`, `blocked_shop_id_list` (maks 500) |
| Ambil push hilang | `v2.push.get_lost_push_message` / `confirm_consumed_lost_push_message` | `last_message_id` |

### 6.2 Yang TIDAK dipakai (sengaja)

`split_order`, `unsplit_order`, `cancel_order`, `set_note`, `search_package_list`,
`update_price`, seluruh alur sengketa retur (`dispute`, `offer`, `accept_offer`,
`get_available_solutions`, `cancel_dispute`), `update_shipping_order`, `batch_ship_order`,
`update_tracking_status`, seluruh Product Push/Webchat/Marketing/Consignment.
Alasan: di luar lingkup operasional gudang, dan setiap fitur tambahan memperluas risiko tanpa nilai.

### 6.3 Kesalahan umum yang DILARANG (sudah diverifikasi tidak ada)

| ❌ Tidak ada | ✅ Yang benar |
|---|---|
| `v2.push.set_shop_push_config` | `v2.push.set_app_push_config` (module Push v2 hanya punya 4 API) |
| field `booking_shipment` | `booking_sn` + `advance_package` |
| `INVOICE_PENDING` sebagai nilai `order_status` response | hanya **nilai filter** di `get_order_list`; bukan anggota enum `OrderStatus` |
| `push_api_id` == `push_code` | **berbeda**. `order_status_push`: `push_api_id=1`, **`push_code=3`** |

## 7. Pemetaan Shopee → domain internal

Ini bagian yang menentukan aplikasi benar atau salah. Prinsip: **status Shopee tidak pernah
disimpan sebagai status internal** — selalu dipetakan, dan nilai aslinya disimpan terpisah untuk audit.

### 7.1 Status pesanan ✅ VERIFIED (`document_id=31` "V2.0 Data Definition" → `OrderStatus`)

Enum resmi lengkap (11 nilai): `UNPAID`, `PENDING`, `READY_TO_SHIP`, `PROCESSED`, `RETRY_SHIP`,
`SHIPPED`, `TO_CONFIRM_RECEIVE`, `IN_CANCEL`, `CANCELLED`, `TO_RETURN`, `COMPLETED`.

| Shopee `order_status` | Internal `OrderStatus` | Alasan |
|---|---|---|
| `UNPAID` | *(belum diimpor)* | Belum ada kewajiban gudang |
| `PENDING` | *(belum diimpor)* | Tidak bisa diatur pengirimannya |
| `READY_TO_SHIP` | `CONFIRMED` | Penjual boleh atur pengiriman → kerja gudang mulai |
| `PROCESSED` | `CONFIRMED` | Penjual **sudah** atur pengiriman & punya no. resi |
| `RETRY_SHIP` | `CONFIRMED` | Pickup gagal, perlu atur ulang |
| `SHIPPED` | `COMPLETED`* | Sudah diserahkan ke 3PL |
| `TO_CONFIRM_RECEIVE` | `COMPLETED`* | Sudah diterima pembeli |
| `IN_CANCEL` | `CONFIRMED` + flag risiko | Pembatalan **sedang diproses**, belum final |
| `CANCELLED` | `CANCELLED` | Final |
| `TO_RETURN` | `COMPLETED` + buat `Return` | Retur sedang berjalan |
| `COMPLETED` | `COMPLETED` | Final |

\* Status fulfillment internal (`READY_TO_PICK → … → HANDED_OVER`) **tidak diambil dari Shopee**.
Itu murni keadaan gudang kami.

### 7.2 Koreksi arsitektural yang menyertainya

`Order.status` saat ini mencampur dua lifecycle: level pesanan (`NEW`, `CONFIRMED`, `CANCELLED`,
`COMPLETED`) **dan** tahap fulfillment (`STOCK_CHECK`, `WAITING_STOCK`, `STOCK_RESERVED`,
`READY_TO_PICK`, `PICKING`, `PICKED`, `PACKING`, `PACKED`, `READY_TO_SHIP`, `HANDED_OVER`,
`EXCEPTION`) — 15 nilai di satu enum (`schema.prisma:362-378`).

Ini melanggar `04-DOMAIN-MODEL.md:58-62` (Order hanya 4 status) dan menjadi akar state machine
yang rusak: `ORDER_TRANSITIONS` (`order/domain/order.entity.ts:31-42`) mewajibkan
`NEW → CONFIRMED → STOCK_CHECK`, sementara `importOrder` membuat order berstatus `NEW` dan
`reserveStockForOrder` (`order.usecase.ts:271`) langsung melompat ke `STOCK_CHECK` →
transisi selalu ditolak.

**Keputusan:** `OrderStatus` = `NEW | CONFIRMED | CANCELLED | COMPLETED` (level pesanan saja).
Tahap fulfillment **hanya** di `FulfillmentOrder.status` (`FulfillmentStatus` sudah memilikinya)
dan `OrderItem.status`. Dua state machine yang terpisah, tidak ada duplikasi.

### 7.3 Status logistik ✅ VERIFIED (`LogisticsStatus`, untuk `package_list[].logistics_status`)

`LOGISTICS_NOT_START`, `LOGISTICS_PENDING_ARRANGE`, `LOGISTICS_COD_REJECTED`, `LOGISTICS_READY`,
`LOGISTICS_REQUEST_CREATED`, `LOGISTICS_PICKUP_DONE`, `LOGISTICS_DELIVERY_DONE`,
`LOGISTICS_INVALID`, `LOGISTICS_REQUEST_CANCELED`, `LOGISTICS_PICKUP_FAILED`,
`LOGISTICS_PICKUP_RETRY`, `LOGISTICS_DELIVERY_FAILED`, `LOGISTICS_LOST`.

| Shopee `LogisticsStatus` | Internal `ShipmentStatus` |
|---|---|
| `LOGISTICS_NOT_START` | `PENDING` |
| `LOGISTICS_PENDING_ARRANGE`, `LOGISTICS_COD_REJECTED` | `PENDING` + `blocked` reason |
| `LOGISTICS_READY` | `READY_TO_SHIP` |
| `LOGISTICS_REQUEST_CREATED` | `READY_TO_SHIP` |
| `LOGISTICS_PICKUP_DONE` | `PICKED_UP` |
| `LOGISTICS_PICKUP_RETRY` | `PICKED_UP` + `EXCEPTION` flag |
| `LOGISTICS_DELIVERY_DONE` | `DELIVERED` |
| `LOGISTICS_REQUEST_CANCELED`, `LOGISTICS_INVALID`, `LOGISTICS_PICKUP_FAILED`, `LOGISTICS_DELIVERY_FAILED`, `LOGISTICS_LOST` | `FAILED` (+ alasan asli) |

Nilai Shopee mentah **selalu** disimpan di `shipment_events.status` + `raw_reference`.

### 7.4 Field tanggal yang benar ✅ VERIFIED

| Field | Dipakai untuk |
|---|---|
| `ship_by_date` | **`Order.shipByAt`** — deadline kirim. Basis prioritas (bukan tanggal pesan) |
| `days_to_ship` | Info persiapan kirim dari seller |
| `pickup_done_time` | Butuh `response_optional_fields=pickup_done_time` |
| `package_list[]` | `package_number`, `logistics_status`, `logistics_channel_id`, `shipping_carrier`, `item_list[]` |
| `fulfillment_flag` | `fulfilled_by_shopee` → **jangan** buat fulfillment order kami sendiri |
| `advance_package` = `true` | Di-fulfill dari advance-fulfilment stock → **seller JANGAN atur pengiriman** |
| `booking_sn` | Hanya untuk order advance-fulfilment |

## 8. Strategi sinkronisasi

Kombinasi, tidak bergantung pada salah satu saja:

1. **Push/webhook** (real-time) — `order_status_push` (code 3), `order_trackingno_push` (code 4),
   `package_fulfillment_status_push` (code 30), `return_updates_push` (code 29).
2. **Sinkronisasi terjadwal** (rekonsiliasi) — tarik `get_order_list` per rentang waktu.
3. **Sinkronisasi manual** (tombol di UI, dengan peran terbatas).

### 8.1 Daftar push code yang dipakai ✅ VERIFIED (dari 34 push resmi)

⚠️ Ada 3 penomoran berbeda yang mudah tertukar: **`push_code`** (kode kanonik, dipakai di payload
`"code": 3` dan di `set_push_config_on/off`), **`push_api_id`** (ID internal, hanya untuk URL doc),
dan **Category id**. Kami **hanya** memakai `push_code`.

| `push_code` | Nama | Payload `data` |
|---|---|---|
| **1** | `shop_authorization_push` | shop baru memberikan otorisasi |
| **2** | `shop_authorization_canceled_push` | otorisasi dicabut → tandai koneksi `INACTIVE` |
| **3** | `order_status_push` | `ordersn`, `status`, `completed_scenario`, `update_time` |
| **4** | `order_trackingno_push` | `ordersn`, `forder_id`, `package_number`, `tracking_no` |
| **12** | `open_api_authorization_expiry` | otorisasi mendekati kedaluwarsa → notifikasi ke user |
| **29** | `return_updates_push` | `order_sn`, `return_sn`, `updated_values` |
| **30** | `package_fulfillment_status_push` | `ordersn`, `package_number`, `fulfillment_status`, `update_time` |

Payload standar: `{ "data": {...}, "shop_id": <int>, "code": <push_code>, "timestamp": <int> }`.
Contoh resmi `order_status_push`:
```json
{"data":{"items":[],"ordersn":"220810QSK8S7BX","status":"PROCESSED","completed_scenario":"","update_time":1660123127},
 "shop_id":727720655,"code":3,"timestamp":1660123127}
```

**ACK**: balas **HTTP 2xx dengan body kosong**. Selain itu Shopee akan **retry**.

## 9. Idempotensi

- Kunci idempotensi push = kombinasi `shop_id` + `code` + `timestamp` + `data.ordersn`/`return_sn`
  (Shopee **tidak** menyediakan event ID). Disimpan di `webhook_events` dengan unique
  `(shop_id, provider, external_event_id)` — kolomnya sudah ada di schema.
- Penerapan wajib **atomik**: `create` lalu tangkap `P2002` → berarti duplikat. **Dilarang**
  pola cek-lalu-tulis (`findUnique` lalu `create`) yang racy.
- Order: unique `(shop_id, external_order_id)` sudah menjamin tidak ada duplikat.
- Push code 2, 3, 12 **tidak mengubah data** — hanya status koneksi/notifikasi.
- **Push hilang**: jika Shopee melaporkan push gagal, pakai `get_lost_push_message`. Selain itu,
  rekonsiliasi terjadwal wajib ada — jangan pernah mengandalkan push saja.

## 10. Penanganan error & retry

Klasifikasi berdasarkan `error` code asli Shopee (bukan HTTP status, karena Shopee
sering membalas **HTTP 200 dengan `error` terisi**):

| Kelas | Contoh `error` | Aksi |
|---|---|---|
| Transient | `error_server`, `error_system_busy`, timeout, HTTP 5xx | Retry + backoff eksponensial, batas 5x |
| Auth | `error_auth`, `error_token_expired`, `error_invalid_access_token` | Refresh token, lalu ulang sekali. Gagal → status koneksi `ERROR` |
| Otorisasi | `error_shop_not_authorized`, `error_partner_not_authorized` | **Stop**, minta user otorisasi ulang. Jangan retry |
| Rate limit | `error_limit`, `error_rate_limit` | Backoff, jadwalkan ulang. Jangan retry cepat |
| Validasi | `order.order_list_invalid_time`, `error_param` | **Jangan** retry. Perbaiki request (mis. rentang >15 hari) |
| Izin | `error_permission` | Tampilkan sebagai masalah konfigurasi yang bisa ditindak |
| Tidak dikenal | lainnya | Catat `request_id` + `error` + `message`, alert, batas retry |

Semua nilai di atas **kode asli Shopee** yang muncul di dump dokumen. Setiap panggilan eksternal
wajib mencatat: `request_id`, `shop_id`, `operation`, `api_path`, `started/finished`, `outcome`,
`retry_count`, `error`. **Jangan pernah log `access_token`, `refresh_token`, atau `partner_key`.**

## 11. Rate limit ⚠️ TIDAK TERDOKUMENTASI

Sudah dicek: **tidak ada satu pun angka rate limit** di 49 doc API (`rate_limit: [0,0,0]` di semua)
maupun di 10 developer guide. Yang ada hanya error `error_limit` / `error_rate_limit`.

**Konsekuensi desain:** kami **tidak mengarang angka**. Yang dilakukan:
(a) batas konkurensi konservatif per shop (1–2 request paralel),
(b) backoff eksponensial saat `error_limit` muncul,
(c) antrean sinkronisasi agar tidak ada burst,
(d) dokumentasikan angka riil **hasil observasi** produksi ke dokumen ini nanti (🔵 TBD).

## 12. Pengerasan endpoint push (wajib)

`integrations/shopee/webhook/route.ts` **tidak boleh** berada di bawah autentikasi JWT pengguna —
pemanggilnya server Shopee, bukan manusia. Kondisi saat ini: middleware mewajibkan
`Authorization: Bearer <JWT user>` → Shopee **selalu** ditolak 401 → integrasi mustahil jalan.

Yang benar, seluruhnya wajib:
1. Dikecualikan dari middleware JWT (`middleware.ts`), dimasukkan sebagai public route.
2. Verifikasi signature `Authorization` (§4.2) — **hex**, atas **raw body**. Gagal → 401.
3. `shop_id` dari payload diverifikasi ada di `shops` dan milik tenant yang benar.
4. `code` diverifikasi termasuk daftar yang didukung (§8.1); selain itu dicatat lalu di-ACK 200.
5. Idempotensi atomik (§9).
6. Rate limiting per IP + per `shop_id`.
7. Balas 2xx **cepat**; pemrosesan berat dijadwalkan asinkron agar tidak memicu retry Shopee.
8. Payload **mentah** disimpan untuk audit; jangan hanya menyimpan hasil parsing.

## 13. Sandbox & approval produksi ✅ VERIFIED

- **Sandbox ADA dan live**: `openplatform.sandbox.test-stable.shopee.sg`,
  `partner.test-stable.shopeemobile.com` (diverifikasi merespons).
  Sandbox memerlukan app terpisah di Console dengan kredensial terpisah.
- **Registrasi partner**: memerlukan data perusahaan & review. Untuk ISV di Indonesia
  dilaporkan **±14 hari kerja**; review "Go Live" ±24 jam (sumber: `document_id=644`, `12`, `14`).
- Artinya: **kode integrasi bisa dibangun & diuji penuh tanpa kredensial produksi**, tetapi
  **tidak bisa** dinyatakan "sudah terhubung" sampai kredensial asli diisi. Karena itu UI
  dilarang menampilkan badge "Terhubung" sebelum ada token yang tersimpan & terbukti valid.

## 14. Keamanan

- `partner_key`, `access_token`, `refresh_token`: **tidak pernah** di source code, client bundle,
  atau log. `access_token`/`refresh_token` dienkripsi at rest dengan `ENCRYPTION_KEY`.
- `ENCRYPTION_KEY` dan `JWT_SECRET` **wajib** ada; aplikasi harus **gagal start** bila kosong.
  (Saat ini `jwt.service.ts:6` punya fallback rahasia hardcoded → token bisa dipalsukan.)
- `.env` **wajib** masuk `.gitignore` (saat ini bocor — lihat §16).
- Checklist di atas dijalankan **server-side**. Shopee tidak pernah diakses dari browser.

## 15. Yang secara eksplisit DI LUAR lingkup

- Marketplace lain (Tokopedia, TikTok Shop, Lazada) — tidak dibuat sama sekali.
- Fitur sengketa retur Shopee (dispute/offer/accept) — hanya baca + konfirmasi terima.
- Mengubah harga produk di Shopee (`update_price`) — hanya stok (`update_stock`).
- Order advance-fulfilment (`advance_package = true`) — di-skip dengan alasan tercatat di log,
  bukan diproses setengah-setengah.
- Order `fulfilled_by_shopee` (FBS) — tidak dibuatkan fulfillment order internal.
- Changelog/versi API Shopee otomatis — tanggung jawab manual.

## 16. Temuan keamanan pada repo ini (harus ditutup sebelum produksi)

| # | Temuan | Lokasi |
|---|---|---|
| 1 | Identitas tenant/aktor dipercaya dari header kiriman klien di 9 route → baca/tulis lintas-tenant penuh | `catalog/products/{route,[productId]/route}.ts`, `integrations/shopee/{sync,webhook}/route.ts`, `returns/**`, `shipments/**` |
| 2 | `tenant-default` / `user-default` sebagai fallback → tenant yang tidak ada di DB | 14× dan 8× di file yang sama |
| 3 | Rahasia JWT fallback hardcoded → pemalsuan token bila env kosong | `jwt.service.ts:5-7` |
| 4 | `.env` tidak di-`.gitignore` → kredensial DB bisa ter-commit | `.gitignore:3-5` |
| 5 | Akun demo plaintext (backdoor login) di server & bundle klien | `auth.usecase.ts:169-218`, `login/page.tsx:158-219` |
| 6 | `verifyWebhookSignature` selalu `true` & tidak pernah dipanggil | `simulated-shopee.adapter.ts:188-192` |
| 7 | Tanpa rate limiting/lockout pada login → credential stuffing | `middleware.ts`, `auth.usecase.ts` |
| 8 | Token disimpan di `localStorage` (bisa dicuri XSS), tidak bisa dicabut | `login/page.tsx:41-44` |
| 9 | Tanpa security header (CSP/HSTS/X-Frame-Options) | `next.config.ts` |

## 17. Sumber

Tarikan mentah lengkap (49 doc API + 34 push + 10 developer guide, dengan `api_path`, `rate_limit`,
`test_url`) ada di `20-SHOPEE-API-REFERENCE.md` dan folder `shopee_research/`.

| Klaim | Sumber resmi |
|---|---|
| Alur otorisasi, expiry, cancel | `document_id=20` — Authorization and Authentication |
| Sign request + contoh base string | `document_id=20`, `document_id=16` |
| Sign push (hex, raw body) | `document_id=18` — Push Mechanism |
| Host produksi & sandbox, format GET/POST | `document_id=16`, `GET /opservice/api/v1/config/host` |
| `OrderStatus` (11 nilai), `LogisticsStatus` | `document_id=31` — V2.0 Data Definition |
| Field `ship_by_date`, `package_list`, `advance_package` | doc `v2.order.get_order_detail` |
| 34 push code + payload + retry + ACK | `push/doc`, `push/category`, `document_id=18` |
| Konfigurasi push | `v2.push.set_app_push_config` (api_id 1542) |
| Sandbox + approval ISV | `document_id=644`, `12`, `14` |
| Batas 15 hari, `page_size`, cursor | doc `v2.order.get_order_list` |
