# Shopee Open Platform v2 — Referensi API Terverifikasi
**Untuk integrasi fulfillment/warehouse (partner/ISV app), market Indonesia.**
Disusun: 2026-09-17. Semua fakta diberi label status verifikasi.

---

## 0. SUMBER & METODE VERIFIKASI

Docs site `https://open.shopee.com` adalah SPA (Nuxt). Halaman `/documents` hanya shell HTML kosong.
**Yang berhasil:** menemukan API internal SPA di base URL `/opservice/api/v1` (dari bundle `app.ab75fce.js`),
lalu menarik **seluruh isi dokumentasi resmi** dari sana:

| Endpoint internal | Fungsi |
|---|---|
| `GET /opservice/api/v1/doc/module/?version=2` | daftar semua modul + item API (32 modul) |
| `GET /opservice/api/v1/doc/api/?version=2&api_id={id}` | dokumen lengkap 1 API (params, response, error, sample, test_url) |
| `GET /opservice/api/v1/doc/api/?version=2&api_name={name}` | lookup by nama |
| `GET /opservice/api/v1/developer_guide/detail?document_id={id}&language_code=en` | isi developer guide |
| `GET /opservice/api/v1/push/category` | katalog push |
| `GET /opservice/api/v1/push/doc?push_api_id={id}` | dokumen 1 push |
| `GET /opservice/api/v1/config/host` | daftar host produksi & sandbox |
| `GET /opservice/api/v1/doc/version_flag` | → `{"show_version":2,"show_v2":true}` |

Artefak lokal tersimpan di `C:\Users\SDM\shopee_research\`:
`api_docs.json`, `apidocs2/*.json` (49 endpoint), `pushdocs/all_push_docs.json` (34 push),
`g20.txt` (Auth), `g31.txt` (Data Definition), `g18.txt` (Push), `g16.txt` (API calls),
`g644.txt` (Sandbox), `g12.txt`/`g14.txt`/`g24.txt` (registrasi & approval), `endpoints_dump.txt`, `params_dump.txt`.

**Verifikasi liveness:** `partner.shopeemobile.com`, `partner.test-stable.shopeemobile.com`, dan
`openplatform.sandbox.test-stable.shopeemobile.sg` semua merespons HTTP 200 dengan
`{"error":"error_param","message":"There is no partner_id in query."}` → path-nya nyata.

URL human-readable ekuivalen: `https://open.shopee.com/documents/v2/v2.order.get_order_detail?module=94&type=1`

---

## 1. AUTH — Alur Otorisasi Partner ✅ VERIFIED

Sumber: guide **"Authorization and Authentication"**, `document_id=20`.
→ `https://open.shopee.com/documents/v2/Authorization-and-Authentication?module=87&type=2`

> ⚠️ **Koreksi:** dok resmi menyebut **3 langkah** (bukan 6): (1) generate authorization link,
> (2) dapatkan otorisasi dari shop, (3) ambil & refresh access_token. Langkah 3–6 di bawah adalah
> rincian langkah (3).

### 1.1 Authorization link (fixed URL, bukan `/api/v2/shop/auth_partner`)

| Environment | Region | URL |
|---|---|---|
| Production | Global (kec. CN & BR) | `https://open.shopee.com/auth` |
| Production | Mainland China | `https://open.shopee.cn/auth` |
| Production | Brazil | `https://open.shopee.com.br/auth` |
| Sandbox | Global | `https://open.sandbox.test-stable.shopee.com/auth` |
| Sandbox | China | `https://open.sandbox.test-stable.shopee.cn/auth` |
| Sandbox | Brazil | `https://open.sandbox.test-stable.shopee.com.br/auth` |

Query params: `partner_id` (int, wajib) · `auth_type` (wajib; `seller`\|`supplier`\|`user`) ·
`redirect_uri` (wajib) · `response_type` (wajib, fixed `"code"`) · `state` (opsional, anti-CSRF, dikembalikan apa adanya).

Contoh produksi (dari dok):
`https://open.shopee.com/auth?partner_id=10090&auth_type=seller&redirect_uri=https://open.shopee.com&response_type=code`

- `redirect_uri` **divalidasi domain** terhadap "Redirect URL Domain" di Console (Live + Test terpisah).
  Mismatch → error `"The domain of redirect_uri is not consistent with the Redirect URL Domain declared in console"`.
  Jika domain callback belum diisi di Console, validasi domain **tidak** diberlakukan.
- **Legacy/alternate:** path `POST/GET /api/v2/shop/auth_partner` dengan param `redirect` masih ada di code demo
  resmi (base string `partner_id + path + timestamp`, tanpa access_token/shop_id).
- Link otorisasi memakai timestamp+sign yang **kedaluwarsa dalam 5 menit**.

### 1.2 Redirect balik
- Shop account → `https://open.shopee.com/?code=xxxxxxxxxx&shop_id=xxxxxx`
- Main account → `https://open.shopee.com/?code=xxxxxx&main_account_id=xxxxxx`
- `code`: **sekali pakai, kedaluwarsa 10 menit**.
- Akun sub-account **tidak bisa** login ke halaman otorisasi.
- Seller memilih masa otorisasi: 7/30/90/180/365 hari atau custom ≤365 hari.

### 1.3 Barter code → token ✅
`POST /api/v2/auth/token/get`
- Produksi: `https://partner.shopeemobile.com/api/v2/auth/token/get`
- Sandbox: `https://openplatform.sandbox.test-stable.shopee.sg/api/v2/auth/token/get`
- Common params (query): `partner_id`, `timestamp`, `sign`
- Body (JSON): `code`, `partner_id`, dan **salah satu** `shop_id` **atau** `main_account_id`
- Response: `access_token`, `refresh_token`, `expire_in`, `request_id`, `error`, `message`,
  plus `merchant_id_list` / `shop_id_list` (jika pakai `main_account_id`), `supplier_id_list`/`user_id_list`.

### 1.4 Refresh ✅
`POST /api/v2/auth/access_token/get`
- Produksi: `https://partner.shopeemobile.com/api/v2/auth/access_token/get`
- Sandbox: `https://openplatform.sandbox.test-stable.shopee.sg/api/v2/auth/access_token/get`
- Query: `partner_id`, `timestamp`, `sign` · Body: `refresh_token`, `partner_id`, + `shop_id` atau `merchant_id`
- `expire_in` contoh nyata: `14400` (= 4 jam).

### 1.5 Masa berlaku ✅
| Item | Masa berlaku |
|---|---|
| `access_token` | **4 jam**, bisa dipakai berulang |
| `refresh_token` | **30 hari**, **sekali pakai** per refresh (dapat refresh_token baru) |
| `code` | 10 menit, sekali pakai |
| timestamp request | 5 menit |
| Otorisasi maksimum | **365 hari** |
| access_token lama setelah refresh | tetap valid **5 menit** lagi |

Catatan resmi: token per `shop_id`/`merchant_id` **harus disimpan terpisah**; otorisasi ulang me-refresh keduanya;
RefreshAccessToken harus dipanggil **di dalam** masa otorisasi.
Untuk `main_account_id`, token awal dibagi bersama; setelah RefreshAccessToken dipanggil per shop/merchant,
masing-masing punya token independen.

### 1.6 Cancel authorization
Fixed URL: `https://open.shopee.com/cancel_auth` (CN: `/cancel_auth` di open.shopee.cn; BR: `.com.br`), params sama.

---

## 2. SIGNATURE ✅ VERIFIED

Sumber: `document_id=20` §"Calculating the sign parameter" + `document_id=16` ("API calls").

### 2.1 Sign API (request)

**Base string** — konkatenasi TANPA separator, urutan **wajib**:

| Tipe API | base_string |
|---|---|
| **Shop API** | `partner_id` + `api_path` + `timestamp` + `access_token` + `shop_id` |
| **Merchant API** | `partner_id` + `api_path` + `timestamp` + `access_token` + `merchant_id` |
| **Public API** | `partner_id` + `api_path` + `timestamp` |

- `api_path` = path **tanpa host**, contoh `/api/v2/shop/get_shop_info`.
- Contoh resmi: `2001887/api/v2/shop/get_shop_info165571443159777174636562737266615546704c6d14701711`

**Algoritma:** `HMAC-SHA256(base_string, partner_key)` → **hex, huruf kecil**.
Contoh resmi: `sign=56f31d01aeda9d08bf456b37f6f6640ef8614b4d6ad49baafe30b39a061f0e26`

> ✅ **Konfirmasi:** untuk Public API (`auth/token/get`, `auth/access_token/get`, `push/*`, `public/*`),
> `access_token` dan `shop_id` **MEMANG DIOMIT** dari base string. Ini eksplisit di dok dan di contoh kode resmi
> (Python `"%s%s%s" % (partner_id, path, timest)`).

### 2.2 Sign Push/Webhook — ⚠️ **HEX, BUKAN BASE64**

Sumber: `document_id=18` ("Push Mechanism notifications") §"Push Authorization".

- Base string: `url + "|" + <raw request body>`
  Contoh resmi: `'http://www.example.com/example/uri|{"shop_id": 123, "code": 1, "success": 1, ...}'`
- Algoritma: `HMAC-SHA256(base_string, partner_key)` → **hex encoding**, lowercase.
- Dok resmi: *"The output of the HMAC signature function is a binary string. This requires **hex encoding** to generate the signature string."*
- Kode Python resmi memakai `hmac.new(...).hexdigest()`; Go memakai `fmt.Sprintf("%x", h.Sum(nil))`;
  Java memakai `Hex.encodeHexString(...)`.
- Nilai ada di **HTTP header `Authorization`**.
- ⚠️ Dok menyarankan **JANGAN** pakai `json.loads(response.content)` — pakai **raw body bytes**.
- Validasi ini **opsional secara teknis tapi sangat direkomendasikan**.

> ❌ **Task assumption `base64(HMAC-SHA256(...))` adalah SALAH.** Yang benar: **lowercase hex**.

---

## 3. BASE URL, FORMAT REQUEST, CONTENT-TYPE ✅

Sumber: `document_id=16`, `GET /opservice/api/v1/config/host`.

### 3.1 Domain produksi (dari `config/host`, resmi)
```
https://partner.shopeemobile.com          # global (deploy dekat SG)  ← utama
https://openplatform.shopee.cn            # China mainland
https://openplatform.shopee.com.br        # Brazil / dekat US
```
### 3.2 Domain sandbox (resmi, LIVE terverifikasi)
```
https://openplatform.sandbox.test-stable.shopee.sg    # semua developer
https://openplatform.sandbox.test-stable.shopee.cn    # China
https://partner.test-stable.shopeemobile.com          # (test_url di tiap dok API)
```

### 3.3 Format request
- Protokol: **HTTP/JSON** (sebagian upload file: HTTP/FORM). Content-Type: `application/json`.
- Hanya **GET** dan **POST**.
- **GET**: common params + request params **semuanya di query string**.
- **POST**: common params di **query string**, request params di **request body (JSON)**.
  Contoh resmi (`v2.shop.update_profile`):
  `POST /api/v2/shop/update_profile?partner_id=851249&timestamp=1654673582&shop_id=1001094&access_token=...&sign=...`
  body: `{"shop_logo":"...","description":"...","shop_name":"..."}`
- **Common params (shopa API):** `partner_id`, `timestamp`, `sign`, `access_token`, `shop_id` (semua di query).
- Format path: `/api/v2/{module}/{action}` (contoh `/api/v2/order/get_order_list`).
- Response standar: `request_id` (selalu), `error` (kosong jika sukses), `message`, `warning` (opsional), `response`.
- Ada juga `error_example` resmi. Contoh dari `get_order_list`:
  `{"error":"order.order_list_invalid_time","message":"Start time must be earlier than end time and diff in 15days."}`

---

## 4. ENDPOINT FULFILLMENT/WAREHOUSE ❌/✅

Semua path di bawah ✅ VERIFIED ada di dok (diambil dari module tree + doc API).
Base produksi: `https://partner.shopeemobile.com` + path. **Semua ini POST** (kecuali dicatat).

### 4.1 Order (module 94)
| API | Path | Param wajib | Catatan |
|---|---|---|---|
| `v2.order.get_order_list` | `/api/v2/order/get_order_list` | `time_range_field`, `time_from`, `time_to`, `page_size` | + `cursor`, `order_status`, `response_optional_fields`, `request_order_status_pending`, `logistics_channel_id` (BR only) |
| `v2.order.get_order_detail` | `/api/v2/order/get_order_detail` | `order_sn_list` (max 50, koma) | + `response_optional_fields`, `request_order_status_pending` |
| `v2.order.get_shipment_list` | `/api/v2/order/get_shipment_list` | `page_size` (1–100) | + `cursor` |
| `v2.order.split_order` | `/api/v2/order/split_order` | `order_sn`, `package_list` | max 30 parcel (TW), max **5 parcel** (region lain) |
| `v2.order.unsplit_order` | `/api/v2/order/unsplit_order` | `order_sn` | |
| `v2.order.cancel_order` | `/api/v2/order/cancel_order` | `order_sn`, `cancel_reason` | |
| `v2.order.handle_buyer_cancellation` | `/api/v2/order/handle_buyer_cancellation` | `order_sn`, `operation` | |
| `v2.order.set_note` | `/api/v2/order/set_note` | `order_sn`, `note` | |
| `v2.order.search_package_list` | `/api/v2/order/search_package_list` | `pagination` | |
| `v2.order.get_package_detail` | `/api/v2/order/get_package_detail` | `package_number_list` | |

### 4.2 Logistics (module 95)
| API | Path | Param wajib |
|---|---|---|
| `v2.logistics.get_channel_list` | `/api/v2/logistics/get_channel_list` | **(tidak ada)** |
| `v2.logistics.get_shipping_parameter` | `/api/v2/logistics/get_shipping_parameter` | `order_sn` |
| `v2.logistics.ship_order` | `/api/v2/logistics/ship_order` | `order_sn` (+ `package_number`, `pickup`, `dropoff`, `non_integrated`) |
| `v2.logistics.batch_ship_order` | `/api/v2/logistics/batch_ship_order` | `order_list` |
| `v2.logistics.get_tracking_number` | `/api/v2/logistics/get_tracking_number` | `order_sn` (+ `package_number`, `response_optional_fields`) |
| `v2.logistics.get_tracking_info` | `/api/v2/logistics/get_tracking_info` | `order_sn` (+ `package_number`) |
| `v2.logistics.update_shipping_order` | `/api/v2/logistics/update_shipping_order` | `order_sn`, `pickup` |
| `v2.logistics.create_shipping_document` | `/api/v2/logistics/create_shipping_document` | `order_list` |
| `v2.logistics.get_shipping_document_result` | `/api/v2/logistics/get_shipping_document_result` | `order_list` |
| `v2.logistics.download_shipping_document` | `/api/v2/logistics/download_shipping_document` | `order_list` |
| `v2.logistics.get_shipping_document_parameter` | `/api/v2/logistics/get_shipping_document_parameter` | `order_list` |
| `v2.logistics.update_tracking_status` | `/api/v2/logistics/update_tracking_status` | `order_sn`, `logistics_status` |

> `ship_order` rule resmi: `pickup` **wajib diisi** hanya jika `get_shipping_parameter` mengembalikan `"pickup"`
> di `info_needed`; field tetap harus **disertakan walau kosong**. Sama untuk `dropoff`/`non_integrated`.

### 4.3 Product (module 89)
| API | Path | Param wajib |
|---|---|---|
| `v2.product.get_item_list` | `/api/v2/product/get_item_list` | `offset`, `page_size` (max 100), `item_status` (bisa multi) |
| `v2.product.get_item_base_info` | `/api/v2/product/get_item_base_info` | `item_id_list` (max 50) |
| `v2.product.get_model_list` | `/api/v2/product/get_model_list` | `item_id` |
| `v2.product.update_stock` | `/api/v2/product/update_stock` | `item_id`, `stock_list` (panjang 1–50) |
| `v2.product.update_price` | `/api/v2/product/update_price` | `item_id`, `price_list` (panjang 1–50) |

`item_status` enum: `NORMAL` / `BANNED` / `UNLIST` / `REVIEWING` / `SELLER_DELETE` / `SHOPEE_DELETE`.

### 4.4 Returns (module 102)
| API | Path | Param wajib |
|---|---|---|
| `v2.returns.get_return_list` | `/api/v2/returns/get_return_list` | `page_no`, `page_size` (≤100) |
| `v2.returns.get_return_detail` | `/api/v2/returns/get_return_detail` | `return_sn` |
| `v2.returns.confirm` | `/api/v2/returns/confirm` | `return_sn` |
| `v2.returns.dispute` | `/api/v2/returns/dispute` | `return_sn`, `email`, `dispute_reason_id` (+`image_list`, `dispute_text_reason`) |
| `v2.returns.get_available_solutions` | `/api/v2/returns/get_available_solutions` | `return_sn` |
| `v2.returns.offer` | `/api/v2/returns/offer` | `return_sn`, `proposed_solution` (+`proposed_adjusted_refund_amount`) |
| `v2.returns.accept_offer` | `/api/v2/returns/accept_offer` | `return_sn` |
| `v2.returns.get_return_dispute_reason` | `/api/v2/returns/get_return_dispute_reason` | `return_sn` |
| `v2.returns.cancel_dispute` | `/api/v2/returns/cancel_dispute` | `return_sn`, `email` |
| `v2.returns.get_reverse_tracking_info` | `/api/v2/returns/get_reverse_tracking_info` | `return_sn` |
| `v2.returns.get_shipping_carrier` | `/api/v2/returns/get_shipping_carrier` | `return_sn` |
| `v2.returns.upload_proof` | `/api/v2/returns/upload_proof` | (lihat doc) |
| `v2.returns.query_proof` | `/api/v2/returns/query_proof` | (lihat doc) |

**3 alur dispute return** ✅ (dari param & deskripsi resmi):
1. **Seller memulai dispute** → `returns/get_return_dispute_reason` (ambil `dispute_reason_id`)
   → `returns/dispute` (`return_sn`, `email`, `dispute_reason_id`, opsional `image_list`, `dispute_text_reason`).
   `image_list` **wajib** untuk semua alasan dispute **kecuali** "Did not receive the return product".
   → bisa dibatalkan via `returns/cancel_dispute` (**hanya** boleh dibatalkan saat `return_status=ACCEPTED`
   dan `compensation_status=COMPENSATION_REQUESTED`).
2. **Negosiasi/penawaran solusi** → `returns/get_available_solutions`
   → `returns/offer` (`proposed_solution` — lihat `ReturnSolution`; opsional `proposed_adjusted_refund_amount`)
   → `returns/accept_offer`.
3. **Bukti/kompensasi** → `returns/upload_proof` / `returns/query_proof`, filter via
   `seller_proof_status`, `seller_compensation_status`, `negotiation_status` di `get_return_list`.

---

## 5. ORDER STATUS ENUM ✅ CRITICAL

Sumber: `document_id=31` **"V2.0 Data Definition"** → `OrderStatus`.

### 5.1 `order_status` (enum sebenarnya, lengkap)
```
UNPAID                Order is created, buyer has not paid yet.
PENDING               Order is pending and cannot proceed to shipment arrangement yet.
READY_TO_SHIP         Seller can arrange shipment.
PROCESSED             Seller has arranged shipment online and got tracking number from 3PL.
RETRY_SHIP            3PL pickup parcel fail. Need to re arrange shipment.
SHIPPED               The parcel has been drop to 3PL or picked up by 3PL.
TO_CONFIRM_RECEIVE    The order has been received by buyer.
IN_CANCEL             The order's cancelation is under processing.
CANCELLED             The order has been canceled.
TO_RETURN             The buyer requested to return the order and order's return is processing.
COMPLETED             The order has been completed.
```

> ⚠️ **`INVOICE_PENDING` TIDAK ADA di enum `OrderStatus` resmi.**
> Tapi `INVOICE_PENDING` **muncul** sebagai nilai filter `order_status` di deskripsi param
> `v2.order.get_order_list`: `"Available value: UNPAID/READY_TO_SHIP/PROCESSED/SHIPPED/COMPLETED/IN_CANCEL/CANCELLED/INVOICE_PENDING"`.
> Jadi: **valid sebagai filter**, **tidak terdokumentasi** sebagai nilai yang dikembalikan di `order_status`
> response. Perlakukan sebagai nilai legacy/region-specific. — STATUS: **PARSIAL**.

### 5.2 `LogisticsStatus` (untuk `package_list[].logistics_status`) ✅
```
LOGISTICS_NOT_START           Initial status, order not ready for fulfillment
LOGISTICS_PENDING_ARRANGE     order logistics pending arrangement
LOGISTICS_COD_REJECTED        Integrated logistics COD: Order rejected for COD
LOGISTICS_READY               ready for fulfillment from payment perspective (non-COD: paid; COD: passed screening)
LOGISTICS_REQUEST_CREATED     order arranged shipment
LOGISTICS_PICKUP_DONE         order handed over to 3PL
LOGISTICS_DELIVERY_DONE       order successfully delivered
LOGISTICS_INVALID             order cancelled when order at LOGISTICS_READY
LOGISTICS_REQUEST_CANCELED    order cancelled when order at LOGISTICS_REQUEST_CREATED
LOGISTICS_PICKUP_FAILED       cancelled by 3PL: failed pickup / picked up but not deliverable
LOGISTICS_PICKUP_RETRY        order pending 3PL retry pickup
LOGISTICS_DELIVERY_FAILED     order cancelled due to 3PL delivery failed
LOGISTICS_LOST                order cancelled due to 3PL lost the order
```
`PackageFulfillmentStatus` (untuk push code 30) memakai subset yang sama (per-package).

### 5.3 Field tanggal/kirim di `get_order_detail` ✅
Dari deskripsi response resmi `v2.order.get_order_detail`:
| Field | Tipe | Deskripsi resmi |
|---|---|---|
| `ship_by_date` | timestamp | **"The deadline to ship out the parcel."** (returned by default) |
| `days_to_ship` | int32 | "Shipping preparation time set by the seller when listing item on Shopee." (default) |
| `pickup_done_time` | timestamp | "The timestamp when pickup is done." (butuh `response_optional_fields=pickup_done_time`) |
| `package_list` | object[] | `package_number`, `logistics_status`, `logistics_channel_id`, `shipping_carrier`, `allow_self_design_awb`, `group_shipment_id`, `item_list[]` |
| `fulfillment_flag` | string | `fulfilled_by_shopee` \| `fulfilled_by_cb_seller` \| `fulfilled_by_local_seller` |
| `split_up` | boolean | apakah order dipecah ke level forder |
| `booking_sn` | string | "Only returned for advance fulfilment matched order only." |
| `advance_package` | boolean | true → order di-fulfill dari advance-fulfilment stock; **seller JANGAN arrange shipment** |
| `return_request_due_date` | timestamp | deadline buyer ajukan R&R setelah COMPLETED |
| `total_amount`, `currency`, `cod`, `payment_method`, `create_time`, `update_time`, `pay_time` | — | lihat `endpoints_dump.txt` |

> ❌ **`booking_shipment` BUKAN field nyata.** Digrep di 49 doc API + 34 doc push + semua guide → **tidak ada**.
> Yang nyata: **`booking_sn`** + **`advance_package`** (+ `advance_package` = order ikut "advance fulfilment").
>
> ⚠️ **`ship_by_date` HANYA "returned by default"** — namun banyak field lain (`pickup_done_time`,
> `package_list`, `item_list`, dll.) **hanya muncul jika diminta lewat `response_optional_fields`**.
> Nilai yang tersedia untuk `get_order_detail`:
> `buyer_user_id, buyer_username, estimated_shipping_fee, recipient_address, actual_shipping_fee, goods_to_declare,
> note, note_update_time, item_list, pay_time, dropshipper, dropshipper_phone, split_up, buyer_cancel_reason,
> cancel_by, cancel_reason, actual_shipping_fee_confirmed, buyer_cpf_id, fulfillment_flag, pickup_done_time,
> package_list, shipping_carrier, payment_method, total_amount, invoice_data, order_chargeable_weight_gram,
> return_request_due_date, edt, payment_info, international_label`

---

## 6. PUSH / WEBHOOK ✅

### 6.1 Konfigurasi
- **Console:** Push Mechanism page → pilih App → Set Push → isi callback URL → **Verify**.
  Shopee mengirim HTTP POST ke callback untuk verifikasi; kegagalan tampil sebagai banner merah.
- **API:** `POST /api/v2/push/set_app_push_config` (module 105, api_type **Public**).
  Request params (semua opsional):
  - `callback_url` (string) — wajib jika belum pernah di-set.
  - `set_push_config_on` (int[]) — contoh `[1,2,3,4,5,8,9,10]`
  - `set_push_config_off` (int[]) — contoh `[6,7,11,12,13]`
  - `blocked_shop_id_list` (int[]) — **maks 500 shop**
- API lain: `v2.push.get_app_push_config`, `v2.push.get_lost_push_message`,
  `v2.push.confirm_consumed_lost_push_message` (`last_message_id`).

> ❌ **`v2.push.set_shop_push_config` TIDAK ADA di v2.** Module Push hanya berisi 4 API di atas
> (`set_app_push_config`, `get_app_push_config`, `get_lost_push_message`, `confirm_consumed_lost_push_message`).
> Guide juga menyebut `v2.push.set_push_config` — tapi API itu **tidak ada** di module tree v2.
> Gunakan **`v2.push.set_app_push_config`**.

### 6.2 Daftar lengkap push code ✅
Sumber: `push/doc` (field `push_code`) + `push/category`. **34 push**.

> ⚠️ **PENTING:** ada 3 penomoran berbeda yang mudah tertukar:
> - `push_code` ← **kode kanonik**, dipakai di payload webhook (`"code": 3`), di guide, dan di `set_push_config_on/off`.
> - `push_api_id` ← **ID internal**, hanya dipakai sebagai param URL `push/doc?push_api_id=N` (**≠ push_code**).
> - Kolom "Category id" dari `push/category` juga berbeda lagi (mis. Return Push `category_id=2078`).

**Order Push (category 1001):**
| push_code | push_api_id | name | payload `data` |
|---|---|---|---|
| **3** | 1 | `order_status_push` | `ordersn`, `status`, `completed_scenario`, `update_time` |
| **4** | 2 | `order_trackingno_push` | `ordersn`, `forder_id`, `package_number`, `tracking_no` |
| **15** | 17 | `shipping_document_status_push` | `order_sn`, `package_number`, `status` |
| **23** | 26 | `booking_status_push` | `booking_sn`, `booking_status`, `update_time` |
| **24** | 27 | `booking_trackingno_push` | `booking_sn`, `tracking_number` |
| **25** | 28 | `booking_shipping_document_status_push` | `booking_sn`, `status` |
| **30** | 33 | `package_fulfillment_status_push` | `ordersn`, `package_number`, `fulfillment_status`, `update_time` |
| **37** | 34 | `courier_delivery_binding_status_push` | `binding_id`, `first_mile_tracking_number`, `status`, `update_time` |
| **47** | 44 | `package_info_push` | `order_sn`, `package_number`, `changed_fields`, `old`, `new`, `update_time` |

**Return Push:** | **29** | 32 | `return_updates_push` | `order_sn`, `return_sn`, `updated_values` |

**Shopee Push:** 1 `shop_authorization_push` (api_id 15) · 2 `shop_authorization_canceled_push` (16) ·
5 `shopee_updates` (3) · 12 `open_api_authorization_expiry` (12) · 28 `shop_penalty_update_push` (31) ·
38 `video_upload_result_push` (43)

**Product Push:** 8 `reserved_stock_change_push` (5) · 11 `video_upload_push` (11) · 13 `brand_register_result` (13) ·
16 `violation_item_push` (18) · 22 `item_price_update_push` (25) · 27 `item_scheduled_publish_failed_push` (30)

**Marketing Push:** 7 `item_promotion_push` (6) · 9 `promotion_update_push` (7)
**Webchat Push:** 10 `webchat_push` (10)
**Consignment Service:** 18 (22) · 19 (23) · 20 (24) · 21 (20)
**Fulfillment by Shopee (FBS):** 31 (41) · 33 (38) · 34 (39) · 35 (40) · 36 (36)

> ⚠️ Guide `document_id=18` memakai penomoran lain di teksnya (mis. menyebut "Shopee Updates (Code:5)"
> dan "Shop Authorization Push (Code:1)") — **itu cocok** dengan `push_code` di atas. Tapi teks guide
> juga menyebut "Return Push" dan "Code:32" dari `push/category` — itu **category_id**, bukan push_code.

### 6.3 Struktur payload & ACK ✅
Payload standar: `{"data": {...}, "shop_id": <int>, "code": <push_code>, "timestamp": <int>}`
Contoh resmi order_status_push:
```json
{"data":{"items":[],"ordersn":"220810QSK8S7BX","status":"PROCESSED","completed_scenario":"","update_time":1660123127},
 "shop_id":727720655,"code":3,"timestamp":1660123127}
```

**Cara ACK push** (dari `document_id=18` §"Push Mechanism Retry Logic"):
- Balas **HTTP status 2xx**
- Dengan **body KOSONG**
> Tidak ada "reply body" khusus. Cukup 2xx + body kosong. Push gagal = tidak ada respons 2xx + body kosong
> dalam timeout (default `push_timeout: 3` detik untuk hampir semua push; webchat 2 detik).

**Retry strategy** (per push, dari doc):
- Order/Logistics/Return/Product/Marketing/Shopee push: `[300, 1800, 10800]` detik.
- FBS: `[60, 300, 1800]`; BR invoice issued: `[30, 600, 1800]`; Consignment 18/19: `[1,3,5]`;
  webchat: `[1,2,3]`.

**Warning/Disable logic:**
- Email peringatan tiap 30 menit jika >600 push dalam 6 jam **dan** success rate <70%.
- **Subscription dinonaktifkan** jika >600 push dalam 6 jam **dan** success rate <30%.
  Setelah disable, push yang terlewat **tidak** dikirim ulang (`get_lost_push_message` bisa membantu).

**App type → push tersedia** (tabel resmi di guide): `ERP System` = semua push kecuali Webchat Push (10).
`Order Management` = hanya Shopee Push (1,2,12,5) + Order Push (3,4,15).

---

## 7. RATE LIMITS ⚠️ TIDAK TERDOKUMENTASI di halaman API

- Field `rate_limit` di **49 doc API** yang saya tarik: semuanya `[0, 0, 0]` atau kosong (string kosong).
  → **TIDAK ADA angka rate limit per-endpoint yang dipublikasikan** di doc API itu sendiri.
- Grep `rate limit` / `rate_limit` / `QPS` / `requests per` di **semua** developer guide (`g*.txt`) → **nol hasil**.
- Endpoint search FAQ/announcement (`/search/global`, `/portal_faq/list`) menolak tanpa param yang benar
  (`error_param`); saya tidak berhasil menemukan halaman rate-limit publik.

**Yang TERVERIFIKASI ada (dari `common_error_list` resmi API):**
- `error_limit` — *"The total API call number made by your APP has reached the **daily API call limit**,
  please try again after 00:00 (UTC+08:00)"* → ada limit **harian per App**, di-reset 00:00 UTC+8.
- `error_rate_limit` — *"Too many requests. You have reached the rate limit. Please try again later."*
  → ada rate limit runtime, tapi angkanya **tidak dipublikasikan** di doc.
- `X-RateLimit-Limit: 5000` / `X-RateLimit-Remaining` hanya muncul di CDN portal `open.shopee.com` (bukan API).

**STATUS: angka pastinya TBD.** Rekomendasi: minta angka konkret via ticket/Account Manager, dan
implementasikan backoff pada `error_rate_limit` / `error_limit`.

---

## 8. SANDBOX & APPROVAL PRODUKSI ✅

### 8.1 Sandbox — ADA dan LIVE ✅
Sumber: guide `document_id=644` ("Sandbox Testing V2") + `config/host`.
- **Sandbox V2 (Test Account - Sandbox v2)**; cek di Console apakah akun Anda sudah V2.
- Cakupan: **Console, Seller Center, dan Open API — semua modul (Product, Global Product, Media Space,
  Order, Logistics, First Mile, Shop, Merchant) = "All APIs"**. Push juga didukung (data tes).
- Batasan: cetak resi di Seller Center belum didukung (pakai Open API).
- Domain: `https://openplatform.sandbox.test-stable.shopee.sg/` (CN: `...test-stable.shopee.cn/`).
- Auth sandbox: `https://open.sandbox.test-stable.shopee.com/auth?auth_type=seller&partner_id=***&redirect_uri=...&response_type=code`
  — **login wajib pakai Sandbox Shop Account**, bukan akun live (kalau salah →
  `"Account/Password Verification Failed"`).
- Push di sandbox: tinggal isi Test Callback URL → "Verify and Save" → klik **"Push Test Data"**
  (tidak perlu trigger event nyata).
- **Terbukti hidup** oleh probe saya: `partner.test-stable.shopeemobile.com` dan
  `openplatform.sandbox.test-stable.shopeemobile.sg` → HTTP 200 `error_param`.
- `test_url` di setiap doc API menunjuk host sandbox (mis. `https://partner.test-stable.shopeemobile.com/api/v2/order/get_order_detail`).

### 8.2 Registrasi developer & approval ✅
Sumber: `document_id=12` (Developer account registration), `document_id=14` (App management), `document_id=24` (Service Partner Program).

**Tipe akun** (pilih saat registrasi):
- **Individual Seller** — perorangan tanpa business license; hanya melayani **shop sendiri** (ditutup untuk BR).
- **Registered Business Seller** — perusahaan dengan lisensi; hanya melayani **shop sendiri**.
- **Third-party Partner Platform (ISV)** — perusahaan terdaftar, melayani **seller lain di Shopee** (ini yang Anda butuhkan).

**Kriteria seller per market (ID):** Mall Sellers **ATAU** Managed Sellers **ATAU** seller dengan
**≥30 order dalam 30 hari terakhir**.
**Syarat ISV:** "You're a registered business. Provide valid business documents during your application."
+ "The business scope of your business license must be **software development**."
+ Wajib sediakan: URL login software (harus `https://` + TLS 1.2) dan akun live testing untuk verifikasi Shopee.
(Wajib "Notify your Account Manager before you apply"; kalau perusahaan terdaftar di China → ikuti skema ERP China.)

**Waktu proses approval (ID):**
- Shopee Seller: **7 hari kerja**
- **Third-party Partner Platform (ISV): 14 hari kerja**

**Go Live:** setelah testing selesai → App List → **Go Live** → isi info →
**"Your App will be reviewed 24 hours after submission"** → setelah approve, dapat **Live Partner_id** dan **Live Key**
(di section App Key). **Tidak bisa dipercepat** — submit minimal 24 jam sebelum tanggal live yang diharapkan.
App baru membuat Test Partner ID + Test Key yang **hanya bisa dipakai di sandbox**.

**Status App:** Developing → Online → (New App authorizations restricted / API calls restricted / Suspended).

**IP whitelist:** jika sistem Anda hanya mengizinkan IP tertentu, panggil `v2.public.get_shopee_ip_ranges`;
IP Anda sendiri harus di-whitelist di Console > App list > IP Address Whitelist (kalau tidak →
`source_ip_undeclared`).

---

## 9. INDONESIA ⚠️ Sebagian

- **Host:** tidak ada host khusus ID. `https://partner.shopeemobile.com` (region global SG) melayani ID.
  Tidak ada entri ID di `config/host` → berarti host global. ✅
- **Region code:** `"ID"` (ISO ALPHA-2) — dari Data Definition `country: ISO ALPHA-2 Code`. ✅
- **Currency:** `IDR` — field `currency` di response order adalah "three-digit code representing the currency
  unit". Tidak ada tabel currency↔market di Data Definition, jadi pemetaan ID↔IDR secara eksplisit **TIDAK**
  terdokumentasi di sumber yang saya tarik. → **UNVERIFIED** (tapi `region=ID` + `currency=IDR` konsisten dengan sample lain
  seperti `region=VN` + `currency=VND`).
- **Timezone:** **TIDAK ADA** pernyataan eksplisit soal timezone (GMT+8 vs local) di guide mana pun
  (`document_id=16`, `31`, `20`). Grep `GMT|UTC|timezone|local time` → **nol hasil**.
  Hanya satu petunjuk: reset limit harian pada **00:00 (UTC+08:00)**.
  → **STATUS: timezone endpoint `time_from`/`time_to` TIDAK TERVERIFIKASI.** Jangan asumsikan;
  uji empiris di sandbox.
- **Kanal kurir/logistics code ID:** `v2.logistics.get_channel_list` **ada dan tidak butuh param** → daftar channel
  harus diambil **runtime per shop**, bukan hardcoded. Nilai `logistics_channel_id` yang muncul di sample doc
  (mis. `18080`, `91007` BR-only, `90021`, `90025`, `90026`, `80003`, `80004`, TW `30029`) **bukan** daftar ID.
  → **Daftar channel ID Indonesia: TBD — ambil dari API.**
- **Ketersediaan endpoint untuk ID:** tidak ada flag market per-API di doc. Beberapa field bertanda region
  spesifik: `dropshipper`/`dropshipper_phone` = **"For Indonesia orders only"** ✅; `prescription_check_status`/
  `prescription_images` = ID & PH whitelisted sellers ✅; `logistics_channel_id` pada `get_order_list` = **valid only for BR**.
- **Approval ID:** ISV **14 hari kerja** ✅ (lihat §8.2). Ada program khusus ISV ID: "For ISVs in Indonesia (ID):
  You must complete registration for the program before you can be enrolled." (guide `document_id=24`).

---

## 10. GOTCHAS ✅ TERVERIFIKASI

1. **Rentang tanggal `get_order_list` maksimum 15 hari** ✅
   Deskripsi resmi param `time_from`/`time_to`: *"The maximum date range that may be specified with the
   time_from and time_to fields is **15 days**."*
   Error resmi: `order.order_list_invalid_time` → *"Start time must be earlier than end time and diff in 15days."*
   Sama untuk `returns/get_return_list` (`create_time_from/to` dan `update_time_from/to`, keduanya max 15 hari,
   dan `update_time_from >= create_time_from`).

2. **`page_size` max** ✅
   - `get_order_list`: **1–100**
   - `get_shipment_list`: **1–100**
   - `get_item_list`: max **100**
   - `get_return_list`: **≤100** (dok menyebut "Default is 40")
   - `order_sn_list` (get_order_detail): limit **[1,50]**
   - `item_id_list` (get_item_base_info): limit **[0,50]**
   - `stock_list`/`price_list` (update_stock/update_price): panjang **1–50**
   - `blocked_shop_id_list`: maks **500**

3. **Pagination** ✅ — `get_order_list` & `get_shipment_list` memakai **cursor**, bukan offset:
   response berisi `"more": true` dan `"next_cursor": "20"`. Kirim balik `next_cursor` sebagai param `cursor`.
   Loop sampai `more == false`. (Contoh resmi sudah terverifikasi.)
   `get_item_list` & `get_return_list` memakai **offset/page_no** (`offset`, `page_no`).
   ⚠️ Terdapat `update_log_list` resmi pada `get_order_list` tanggal **2025-04-23**: *"Change the cursor input parameter."*

4. **Field opsional harus diminta eksplisit** ✅ — banyak field `get_order_detail`/`get_tracking_number`
   **tidak muncul** kecuali diminta via `response_optional_fields` (lihat §5.3). Ini penyebab paling umum
   "field hilang" saat integrasi.

5. **`PENDING` status baru** ✅ — `PENDING` perlu `request_order_status_pending=true` (param kompatibilitas
   masa migrasi) pada `get_order_list` **dan** `get_order_detail`. Tanpa itu, logika lama berlaku.
   `PENDING` juga muncul sebagai `pending_terms` (`SYSTEM_PENDING` / `KYC_PENDING` / `ARRANGE_SHIPMENT_PENDING`).
   Pada `ARRANGE_SHIPMENT_PENDING`: *"Label print will be available within 4 days after buyer paid."*

6. **PROCESSED vs READY_TO_SHIP** ✅ (definisi resmi, jawaban langsung):
   - `READY_TO_SHIP` = **"Seller can arrange shipment."** → belum ada nomor resi, order **siap** dikirim.
   - `PROCESSED` = **"Seller has arranged shipment online and got tracking number from 3PL."** → sudah
     arrange shipment **dan** sudah dapat tracking number.
   - Jadi urutan normal: `READY_TO_SHIP` → `PROCESSED` → `SHIPPED` → `TO_CONFIRM_RECEIVE`/`COMPLETED`.
   - Tambahan: `RETRY_SHIP` = 3PL gagal pickup, harus re-arrange.
   - ⚠️ Push `order_status_push` contoh resminya mengirim `"status": "PROCESSED"`.
   - ⚠️ Ada satu **jalur `COMPLETED` khusus**: `completed_scenario` (`NORMAL` = order selesai;
     `RRAOC` = seluruh rantai *raise return&refund after order completed* selesai).

7. **`total_amount` hanya muncul setelah pembayaran** ✅ — *"This value will only return after the buyer has
   completed payment for the order."*

8. **`pay_time`** ✅ — *"The time when the order status is updated from UNPAID to **PAID**"*. NULL jika belum bayar.
   (`PAID` sendiri **tidak** ada di enum `OrderStatus` — hanya dipakai di deskripsi ini.)

9. **Otorisasi per-shop harus disimpan terpisah** ✅ dan `refresh_token` **sekali pakai**.

10. **Sub-account tidak bisa** login ke halaman otorisasi ✅.

11. **Push sign = hex, bukan base64; header = `Authorization`; pakai raw body** ✅ (§2.2).

12. **`push_api_id` ≠ `push_code`** ✅ (§6.2) — kesalahan paling mudah terjadi saat konfigurasi push.

13. **`set_push_config_on` memakai push_code** (1–11 dst.), **bukan** `push_api_id` ✅ — dari deskripsi resmi param.

14. **Tidak ada `set_shop_push_config` di v2** ✅; juga `v2.push.set_push_config` yang disebut di guide
    **tidak ada** di module tree v2.

15. **`time_range_field`** ✅ hanya `create_time` atau `update_time`.

16. **`logistics_channel_id` filter di `get_order_list` hanya valid untuk BR** ✅.

---

## 11. RINGKASAN STATUS VERIFIKASI

| # | Area | Status |
|---|---|---|
| 1 | Auth flow, URL, expiry (4h/30d/10min/365d) | ✅ VERIFIED (`document_id=20`) |
| 2a | Sign API: base string + HMAC-SHA256 hex lowercase | ✅ VERIFIED (`document_id=20`, `16`) |
| 2b | Sign push: `url \| raw_body`, HMAC-SHA256 — **hex, bukan base64** | ✅ VERIFIED, **koreksi** (`document_id=18`) |
| 2c | `access_token`/`shop_id` diomit untuk Public API | ✅ VERIFIED (`document_id=16`) |
| 3 | Host produksi & sandbox, GET/POST, content-type | ✅ VERIFIED (`document_id=16`, `config/host`) |
| 4 | 40+ endpoint fulfillment/warehouse (path + param wajib) | ✅ VERIFIED (49 doc API ditarik) |
| 5a | `OrderStatus` enum (11 nilai) | ✅ VERIFIED (`document_id=31`) |
| 5b | `INVOICE_PENDING` | ⚠️ PARSIAL — hanya sebagai *filter*, tidak di enum |
| 5c | `ship_by_date`, `days_to_ship`, `pickup_done_time` | ✅ VERIFIED (doc `get_order_detail`) |
| 5d | `booking_shipment` | ❌ **TIDAK ADA** — yang nyata `booking_sn` + `advance_package` |
| 6a | `push/set_app_push_config` + param | ✅ VERIFIED (api_id 1542) |
| 6b | `push/set_shop_push_config` | ❌ **TIDAK ADA di v2** |
| 6c | 34 push code + payload + retry + ack (2xx + body kosong) | ✅ VERIFIED (`push/doc`, `push/category`) |
| 7 | Angka rate limit per-endpoint | ⚠️ **TIDAK TERDOKUMENTASI** — hanya error `error_limit`/`error_rate_limit`; angka TBD |
| 8 | Sandbox (V2) ADA + host live; approval ISV 14 hari kerja ID; review Go Live 24 jam | ✅ VERIFIED (`document_id=644`, `12`, `14`) |
| 9 | ID: host global, region `ID`; currency `IDR`; timezone; channel ID | ⚠️ SEBAGIAN — timezone & daftar channel ID **TBD** (channel harus diambil runtime) |
| 10 | 15-hari range, page_size max, cursor, optional fields, PROCESSED vs READY_TO_SHIP | ✅ VERIFIED |
