# Riwayat Pengujian & Bukti Verifikasi

Dokumen ini mencatat **hasil pengujian yang benar-benar dijalankan** beserta perintahnya.
Dokumen ini adalah sumber materi untuk jurnal; setiap angka di bawah bisa diverifikasi ulang
dengan perintah yang sama.

> Aturan: jangan menulis "lulus" untuk sesuatu yang belum dijalankan. Skipped bukan lulus.

---

## 1. Ringkasan status (per 2026-09-25, setelah deploy produksi)

| Lapisan | Perintah | Hasil |
|---|---|---|
| Tipe | `npm run typecheck` | ✅ 0 error |
| Lint | `npm run lint` | ✅ 0 error, 0 warning |
| Unit + regresi | `npm test` | ✅ **120 lulus** |
| Build produksi | `npm run build` | ✅ exit 0, 44 route |
| E2E HTTP + MySQL | `E2E_BASE_URL=http://localhost:3000 npx vitest run src/e2e/fulfillment-flow.test.ts` | ✅ **11/11 lulus** |
| Deploy VPS | `SSHPASS=… uv run --with paramiko python deploy/update-vps.py` | ✅ selesai, PM2 `online` |
| Produksi HTTPS | `https://103-178-174-224.sslip.io` | ✅ 200 |
| Browser QA produksi | chromium via `browser_*` | ✅ login, halaman utama, scan, label, PWA |
| PWA produksi | curl + `browser_console` | ✅ manifest, `sw.js`, controller aktif, cache hanya `/offline.html` |
| Kamera di perangkat nyata | — | ⛔ **belum diuji** (butuh HP; di produksi sudah HTTPS & `getUserMedia` tersedia) |

---

## 2. Apa yang diuji unit/regresi

Berkas: `src/modules/fulfillment/application/packing-stock-rules.test.ts`
(13 test) dan `src/modules/fulfillment/domain/operator-workflow.test.ts` (7 test).

### 2.1 Stok hanya berkurang di satu tempat

| Test | Membuktikan |
|---|---|
| mengurangi stok fisik + ledger `DEDUCTION` | `inventoryBalance.upsert` dengan `decrement`, `inventoryMovement.create` `quantityDelta: -2` |
| lot FIFO | batch terlama (`lot-lama`) dikonsumsi lebih dulu |
| tolak picking belum dikonfirmasi | error sebelum menyentuh stok |
| tolak transisi `WAITING_STOCK → PACKED` | error sebelum menyentuh stok |

### 2.2 Anti potong stok ganda

| Test | Membuktikan |
|---|---|
| dua operator memindai bersamaan | `fulfillmentOrder.updateMany` claim status dulu; `count === 0` → error, `inventoryMovement.create` **tidak** dipanggil |
| kunci pembuka didahulukan | urutan `updateMany` (claim `PACKING`) < `inventoryMovement.create` |

Implementasi: `completePacking()` melakukan conditional update
`{ where: { id, status: fo.status }, data: { status: 'PACKING' } }` di awal transaksi.
Tanpa ini, dua scan paralel bisa sama-sama membaca status lama dan memotong stok dua kali.

### 2.3 State machine handover

| Test | Masukan | Diharapkan |
|---|---|---|
| terima `PACKED` | `PACKED` | dua transisi: `READY_TO_SHIP` lalu `HANDED_OVER`, tanpa deduction kedua |
| terima `READY_TO_SHIP` | `READY_TO_SHIP` | satu transisi ke `HANDED_OVER` |
| terima shipment `PICKED_UP` | `READY_TO_SHIP` + shipment `PICKED_UP` | tetap `HANDED_OVER` |
| tolak status lain | `PICKED` | error "belum siap diserahkan", tanpa `fulfillmentOrder.update` |
| tolak stok belum terpotong | `fulfilledQuantity < quantity` | error "Stok belum dikurangi" |

Rantai resmi tetap: `PACKED → READY_TO_SHIP → HANDED_OVER`.

---

## 3. E2E dengan HTTP + MySQL asli

Fixture: gudang uji `E2E-WH-01`, varian produk Shopee asli
`cmub69ndf0005w75g9f89dwy9`. Test membersihkan sendiri seluruh data yang dibuat.

| # | Skenario | Hasil |
|---|---|---|
| 1 | daftar produk hanya berisi produk Shopee asli | ✅ |
| 2 | stok masuk dicatat sebagai lot FIFO | ✅ |
| 3 | scan resi memotong lot terlama lebih dulu | ✅ `deductedUnits: 4`, lot `[1, 3]` |
| 4 | stok kurang tidak memotong stok dan tidak mengaku sukses | ✅ `WAITING_STOCK`, `stockDeducted: false` |
| 5 | handover tidak menambah potongan stok | ✅ jumlah `DEDUCTION` tetap sama, status `HANDED_OVER` |
| 6 | scan ulang pesanan yang sudah dikemas | ✅ `ALREADY_*`, deduction tidak bertambah |
| 6b | gerbang resi: nomor pesanan tidak menyelesaikan packing | ✅ `NEEDS_SHIPMENT`, stok tidak tersentuh |
| 7 | "Ambil Resi dari Shopee" pada order yang tidak ada di Shopee | ✅ gagal **jujur**, `simulated: false`, tidak ada AWB karangan tersimpan |
| 8 | daftar kerja: urutan & tahapan | ✅ |
| 9 | laporan keuangan memakai angka Shopee | ✅ |
| 10 | tarik rincian biaya melaporkan keadaan sebenarnya | ✅ |

### 3.1 Catatan penting tentang nomor resi

Aplikasi **tidak pernah membuat nomor resi**. Sebelumnya ada fallback `SPXID…`; kode itu
sudah dihapus. Sekarang:

- `prepare-shipment` gagal apa adanya bila Shopee tidak menerbitkan resi;
- field `simulated` selalu `false` (dipertahankan hanya agar UI lama tidak rusak);
- test E2E menulis AWB fixture langsung ke DB (`E2E-AWB-*`) karena order `E2E-*`
  memang tidak ada di Shopee — jadi gerbang AWB tetap diuji dengan data nyata.

---

## 4. Black-box / browser QA lokal

| Pengujian | Bukti |
|---|---|
| login `owner@toko.id` | redirect ke `/dashboard`, judul "Pusat Kendali Operasional" |
| semua halaman dashboard | 11 path → HTTP 200 |
| redirect halaman lama | `/dashboard/operasi` → `/dashboard/pesanan` |
| scan manual marker unik | input `SPXID9999TEST` → pesan error memuat **marker itu sendiri** |
| tombol scan per pesanan | hanya memfokuskan input scanner; input tetap kosong (tidak mengambil AWB dari DB) |
| handover AWB salah | HTTP 422 "Nomor resi pada paket tidak cocok" |
| handover AWB benar | HTTP 200 "Pesanan diserahkan ke kurir" |
| label resmi | `POST print-label` → `application/pdf`, magic `%PDF`, 77.549 byte |
| PWA | `manifest.webmanifest` 200, `sw.js` 200 + CSP, controller `/sw.js` |
| cache service worker | hanya `/offline.html`; tidak ada `/api/*` |
| request gagal | 0 respons ≥ 400 saat memuat halaman |

> Assertion memakai **marker yang ditanam sendiri** (`SPXID9999TEST`), bukan pola umum
> yang bisa cocok dengan pesan gagal.

---

## 5. Mutu kode (black-box pada kontrak)

| Kontrak | Bukti |
|---|---|
| tidak ada `gradient` di `src/**` | pencarian 0 hasil |
| tidak ada emoji | pencarian 0 hasil |
| tidak ada `scannedCode: o.awb` / `shipment.awb` | 0 hasil di production code (hanya di E2E dengan alasan eksplisit) |
| tidak ada parameter domain mati (`hasFulfillment`) | dihapus |
| `findOrderByCode` benar-benar dua tahap | `await` eksplisit; `??` pada `Promise` pernah membuat cabang kedua mati |
| mapping status logistik benar arti | `LOGISTICS_REQUEST_CREATED` → `READY_TO_SHIP` (bukan `PICKED_UP`); hanya `LOGISTICS_PICKUP_DONE` → `PICKED_UP` |
| `stockDeducted` jujur | `ALREADY_PACKED` / `ALREADY_HANDED_OVER` sekarang `stockDeducted: false` |
| SSE tidak palsu | broadcast hanya bila `deductedUnits > 0` |
| label fail-closed | `result_list` kosong / paket tidak cocok / JSON / HTML / signature asing ditolak |
| error provider tampil | dibungkus `ExternalIntegrationError` (HTTP 502), bukan `INTERNAL_ERROR` |

---

## 6. Verifikasi produksi (2026-09-25)

Deploy memakai `deploy/update-vps.py` (bukan `remote_deploy.py`, yang akan membuat ulang
`JWT_SECRET` dan `ENCRYPTION_KEY` sehingga sesi logout dan kredensial Shopee tidak bisa
didekripsi lagi). `.env` produksi tidak ditimpa — tetap berkas 24 Sep 2026.

| Yang diperiksa | Hasil |
|---|---|
| `/login`, `/manifest.webmanifest`, `/sw.js`, `/offline.html` | semua 200 |
| `Cache-Control` pada `sw.js` | `no-cache, no-store, must-revalidate` |
| `Content-Security-Policy` pada `sw.js` | `default-src 'self'; script-src 'self'` |
| Halaman privat | `307` + `Cache-Control: no-store` (tidak di-cache) |
| PM2 | `efulfill` status `online` |
| Migrasi database | `Database schema is up to date!` (5 migrasi) |
| Login browser | `owner@toko.id` → `/dashboard`, judul "Pusat Kendali Operasional" |
| Service worker | controller `https://103-178-174-224.sslip.io/sw.js` |
| Isi cache | hanya `/offline.html`; nol `/api/*` |
| Scan marker `PROD-QA-MARKER-9X7K2` | ditolak, kode `NOT_FOUND`, pesan memuat marker itu sendiri |
| Nomor pesanan (bukan resi) | ditolak, kode `ALREADY_PACKED`, `stockDeducted: false` |
| Label resmi | HTTP 200, `application/pdf`, magic `%PDF`, 78.384 byte |

### 6.1 Data lama yang dibersihkan

Tiga pesanan masih memuat nomor resi karangan `SPXID…` yang dibuat oleh kode lama
sebelum aplikasi menolak mengarang nomor resi. Semuanya dikosongkan
(`awb = null`, status `PENDING`, antrian kembali ke `PICKED`) supaya operator
meminta nomor resi asli ke Shopee. **Pesanan dan produk tidak dihapus.**
Setelah dibersihkan: `sisa resi karang = 0`.

---

## 7. Yang BELUM terbukti (harus jujur)

| Item | Alasan |
|---|---|
| Kamera membaca barcode fisik | butuh HP + HTTPS produksi; fake camera hanya membuktikan wiring |
| Install PWA di Android/iOS | butuh perangkat nyata |
| Offline setelah reload kedua di perangkat | butuh perangkat nyata |
| Label multi-paket (`package_number` > 1) | `Shipment` belum menyimpan `package_number`; order terbagi > 1 paket belum diuji |
| `THERMAL_UNPACKAGED_LABEL` | memakai job flow khusus Shopee; aplikasi menolak eksplisit dengan pesan yang bisa ditindaklanjuti, bukan diam-diam |
| Split-package label | risiko; lihat catatan di atas |
| Go Live Shopee | butuh Redirect URL Domain HTTPS didaftarkan + review ±24 jam (tidak bisa dipercepat) |

---

## 8. Cara mengulang semuanya

```bash
# Gate lokal
npm run typecheck
npm run lint
npm test

# Build produksi (hentikan server dulu — .next dipakai bersama)
npm run build

# E2E (butuh server + MySQL)
npm run start -- -p 3000
E2E_BASE_URL=http://localhost:3000 npx vitest run src/e2e/fulfillment-flow.test.ts

# Deploy ke produksi (JANGAN pakai remote_deploy.py)
SSHPASS='<password root>' VPS_HOST=103.178.174.224 \
  uv run --with paramiko python deploy/update-vps.py

# Verifikasi produksi
curl -sI https://103-178-174-224.sslip.io/sw.js
curl -s  https://103-178-174-224.sslip.io/manifest.webmanifest
```

> `remote_deploy.py` hanya untuk pemasangan dari nol. Setiap kali dipakai ia membuat
> ulang `JWT_SECRET` dan `ENCRYPTION_KEY`, sehingga sesi logout dan kredensial Shopee
> tersimpan di database tidak bisa didekripsi lagi.

Server uji memakai gudang khusus `E2E-WH-01` supaya tidak berebut stok dengan
pesanan asli yang sedang berjalan. Jangan `prisma migrate reset` — data klien hilang.
