# Pengajuan Go Live — Shopee Open Platform (draf isian siap tempel)

> Semua isi di dokumen ini bersumber dari **dokumentasi resmi Shopee Open Platform** yang sudah saya buka dan baca:
> Developer Guide **/12** (pendaftaran & kelayakan), **/14** (App type, Go Live, status App, FAQ),
> **/16** & **/20** (otorisasi, redirect URL), **/18** (push), **/31** (Data Definition), **/229** (logistik),
> **/644** (uji push di sandbox), dan halaman API docs
> `open.shopee.com/documents/v2/...`. Bagian yang tidak ada di dokumen resmi saya tandai
> **"tidak ada di dokumen resmi"** — tidak saya karang.

---

## ⚠️ TIGA HAL YANG HARUS DICEK DULU (ini penentu deadline Anda)

### 1. Kelayakan akun penjual di Indonesia — INI GERBANG TERBESAR

Kutipan resmi (Developer Guide /12, §3.1):

> **ID (Indonesia): Mall Sellers OR Managed Sellers OR Sellers with at least 30 orders in the last 30 days.**

Artinya untuk mendaftar/menjadi seller developer di Open Platform Indonesia, toko Anda harus salah satu dari:
- **Mall Seller**, atau
- **Managed Seller**, atau
- **punya minimal 30 pesanan dalam 30 hari terakhir.**

**Silakan cek dulu di toko Anda.** Kalau toko Anda belum memenuhi salah satunya, pengajuan bisa tertahan
bukan karena aplikasinya, tetapi karena syarat kelayakan akun. Ini alasan kenapa saya minta dicek lebih dulu
sebelum mengisi formulir.

### 2. Redirect URL Domain WAJIB HTTPS (localhost tidak bisa dipakai untuk Live)

Kutipan resmi (Developer Guide /20 dan /16):

> *"All developers are required to configure the Test Redirect URL Domain and Live Redirect URL Domain for
> each App in the Console."* — wajib **HTTPS + TLS 1.2+**.
> Jika tidak cocok: *"The domain of redirect_uri is not consistent with the Redirect URL Domain declared in console"*.

Saat ini aplikasi Anda memakai `http://localhost:3000/api/v1/integrations/shopee/callback` (HTTP, alamat lokal).
**localhost tidak akan lolos untuk Live.** Anda perlu:
1. Hosting aplikasi di **domain HTTPS** (mis. `https://gudang.tokosaya.com`), lalu
2. Daftarkan domain itu di Console pada **Test Redirect URL Domain** dan **Live Redirect URL Domain**, dan
3. Isi **Redirect URL** di aplikasi (menu Hubungkan Shopee) memakai domain HTTPS tersebut.

### 3. Review Go Live 24 jam — tidak bisa dipercepat

Kutipan resmi (Developer Guide /14, FAQ Q4):

> *"Can the review process for an App to go live be expedited? **A: No.** You should submit your App for
> review at least 24 hours before the expected live date."*

Jika profil akun Anda belum pernah disetujui, ada tambahan waktu: pengajuan profil penjual Indonesia
**±7 hari kerja** (Developer Guide /12). Karena aplikasi Anda sudah punya Partner ID **dan** sudah bisa
mengotorisasi toko, artinya **profil Anda sudah lolos** — yang tersisa hanya review Go Live (±24 jam).

---

## 1. Kondisi sistem Anda sekarang (dari aplikasi sendiri)

| Hal | Nilai |
|---|---|
| Tipe akun developer | **Individual Seller** |
| Tipe App yang diizinkan | **Seller In-house System** (satu-satunya untuk Individual Seller; hak akses "All API including Chat API") |
| Partner ID (uji) | `1245182` |
| Toko ter-otorisasi | Shop ID `227924786` (Shopee Official Store) |
| Mode saat ini | **Sandbox (uji)** |
| Status App | **Developing** — belum bisa akses data toko asli & API produksi |
| Redirect URL terdaftar | `http://localhost:3000/api/v1/integrations/shopee/callback` ← **harus diganti HTTPS sebelum Live** |

### 1.1 Lingkungan produksi yang SUDAH berjalan (terverifikasi)

| Hal | Nilai |
|---|---|
| Alamat aplikasi | **https://103-178-174-224.sslip.io** |
| Sertifikat SSL | **Sah** (Let's Encrypt), berlaku sampai 23 Des 2026, diperbarui otomatis |
| Redirect URL produksi | `https://103-178-174-224.sslip.io/api/v1/integrations/shopee/callback` |
| Server | VPS Ubuntu 26.04, 4 CPU, RAM 7,7 GB, disk 40 GB |
| Alamat IP server (untuk Deklarasi Aset IT) | **103.178.174.224 (statis)** |
| Database | MySQL 8 di server yang sama, zona waktu Asia/Jakarta |
| Aplikasi | Next.js produksi dikelola PM2 (`efulfill`), pintu depan Nginx |
| Sinkronisasi otomatis | Aktif: menarik pesanan/resi dari Shopee **setiap 60 detik** di sisi server |
| Akun pemilik | `owner@toko.id` (kata sandi awal dikirim terpisah — **segera ganti** setelah login pertama) |

Catatan: hostname memakai layanan gratis `sslip.io` (hostname berbasis IP) supaya
sudah bisa HTTPS hari ini tanpa membeli domain. Setelah domain dibeli, cukup arahkan
A record ke `103.178.174.224` lalu ikuti `deploy/README-DEPLOY.md` bagian 4 —
Redirect URL di Console juga harus diganti agar sama persis.

### 1.2 Tiga langkah yang harus Anda lakukan sekarang (butuh akun Shopee Anda)

1. **Daftarkan Redirect URL produksi** di Shopee Open Platform Console →
   App Management → Redirect URL:
   `https://103-178-174-224.sslip.io/api/v1/integrations/shopee/callback`
2. **Otorisasi toko**: buka `https://103-178-174-224.sslip.io` → masuk sebagai
   `owner@toko.id` → menu **Hubungkan Shopee** → klik otorisasi. Setelah itu
   sinkronisasi otomatis mulai menarik pesanan (selama App masih Developing,
   yang bisa diotorisasi adalah **Test Shop**).
3. **Uji dari HP**: buka alamat yang sama di HP → menu Pesanan & Pengiriman →
   **Scan dengan Kamera** (kamera HP perlu izin) → arahkan ke barcode resi.

**Arti status Developing (kutipan resmi):** *"Apps cannot be authorized to access shop data in the production
environment"* dan *"Unable to call production environment APIs"*. Inilah sebabnya toko asli belum bisa
tersambung dan nomor resi masih **simulasi** (aplikasi sudah memberi label "mode uji / simulasi" — tidak pernah
diam-diam mengaku resi asli).

---

## 2. Checklist sebelum menekan "Go Live"

- [ ] **Kelayakan akun** terpenuhi (lihat peringatan #1).
- [ ] Aplikasi sudah dites penuh di sandbox: sinkron pesanan, atur pengiriman, cetak resi, stok, laporan.
- [ ] **Otorisasi + penyimpanan token** jalan — ✅ sudah ada (token terenkripsi AES-256-GCM, refresh otomatis).
- [ ] **Redirect URL Domain (Test & Live) terdaftar HTTPS** di Console — ⬜ perlu Anda kerjakan.
- [ ] **Callback URL sandbox** diisi (Console: Tools → push/callback) — untuk uji push.
- [ ] Alamat IP server untuk **Declaration of IT Assets** (lihat bagian 4).
- [ ] **URL aplikasi versi Live** (HTTPS, bisa dibuka & bisa login) + **username & password uji** yang benar-benar bekerja.
- [ ] **Brief Introduction** ≤ 500 karakter (sudah saya siapkan di bagian 3).
- [ ] **Tangkapan layar UI** (`.png/.jpg/.jpeg`, maks **6 MB per file**, sampai **10 file**).
- [ ] Ajukan **minimal 24 jam** sebelum target live.

---

## 3. Isian formulir "Go Live" → bagian **Product Brief** (field resmi)

| Field (persis nama di Console) | Batas | Isi yang disarankan |
|---|---|---|
| *Please provide a live version of your business product's URL for Shopee's testing purposes* | 200 karakter | `https://<domain-anda>/login` (halaman login aplikasi gudang Anda) |
| *Test Username of Business Product* | — | mis. `owner@toko.id` (akun yang benar-benar bisa login) |
| *Test Password of Business Product* | — | (isi password akun uji Anda) |
| *Brief Introduction* | 500 karakter | lihat teks siap tempel di bawah |
| *Your client user interface screenshot* | maks 10 file, < 6 MB | Pesanan & Pengiriman, Stok Gudang, Scan Resi (kamera aktif), Laporan Keuangan |

### Brief Introduction — versi Inggris (tempel apa adanya, 483 karakter)

```
E-Fulfill Hub is the in-house warehouse and order system of our own Shopee shop. It syncs our shop's orders
and payment details, keeps warehouse stock accurate with FIFO batches (independent from the marketplace
stock counter), arranges shipment to obtain tracking numbers, prints labels, and gives a simple finance
report. Used only by our own shop, not offered to third parties.
```

### Brief Introduction — versi Indonesia (untuk pemahaman Anda)

> "E-Fulfill Hub adalah sistem gudang dan pesanan internal toko Shopee kami sendiri. Sistem menyinkronkan
> pesanan dan rincian pembayaran milik toko kami, menjaga stok gudang akurat dengan pencatatan batch FIFO
> (tidak memakai angka stok Shopee), mengatur pengiriman untuk mendapatkan nomor resi, mencetak label, dan
> menyusun laporan keuangan sederhana. Hanya dipakai toko kami sendiri, tidak diberikan ke pihak lain."

---

## 4. Bagian lain di App details

| Field | Isi |
|---|---|
| **App Category** | `Order Management` (fungsi utama) — boleh tambah `Accounting and Finance` bila diminta |
| **App Tag** | `Fulfillment`, `Warehouse`, `Order Management` |
| **Test Call Back URL** | `https://<domain-anda>/api/v1/integrations/shopee/webhook` (untuk uji push di sandbox) |
| **API Call Limit** | sesuai kebutuhan (sinkronisasi 1×/menit + webhook) |
| **App Description** | pakai teks "Brief Introduction" di atas |

### Declaration of IT Assets → Application Servers

Isi salah satu (dokumen resmi: *"strongly encouraged to use static IP addresses"*):

- **IP address(es) available** → tulis IP publik server aplikasi Anda (paling dianjurkan).
- **IP address(es) unavailable** → isi alasan (maks 200 karakter), contoh siap tempel:

```
Our application server is hosted on a provider that assigns a dynamic public IP address, so the address may
change without notice. Data is stored in our own MySQL database and is not shared with third parties.
```

---

## 5. Setelah disetujui Live

1. Di Console: ambil **Live Partner ID** dan **Live Key** (bagian *App Key*).
2. Di aplikasi (menu **Hubungkan Shopee**): ganti **Partner ID** dan **Partner Key** ke nilai Live, ubah
   **Mode Aplikasi** ke **Produksi**, lalu klik **"Uji Koneksi ke Shopee"**.
3. Otorisasi ulang toko asli Anda (setelah Live, toko asli boleh diotorisasi).
4. (Opsional) Aktifkan **Push Mechanism** di lingkungan produksi.
5. (Opsional) Whitelist IP Shopee lewat API `v2.public.get_shopee_ip_ranges` (lingkungan produksi).

---

## 6. Catatan teknis resmi yang memengaruhi fitur aplikasi

| Topik | Fakta resmi | Dampak ke aplikasi |
|---|---|---|
| Rincian biaya pesanan | `order_income` **tidak ada** di `v2.order.get_order_detail`. Rincian tersedia di modul Payment: `v2.payment.get_escrow_detail` / `get_escrow_detail_batch` (maks 50 order per panggilan) | ✅ Sudah diterapkan: aplikasi menarik rincian biaya lewat modul Payment (otomatis + tombol manual) |
| Nama field uang | Yang benar: `order_selling_price`, `seller_discount`/`order_seller_discount`, `shopee_discount`, `buyer_paid_shipping_fee`, `shipping_fee_discount_from_3pl`, `commission_fee`, `service_fee`, `campaign_fee`, `escrow_tax`, `escrow_amount(_after_adjustment)` | ✅ Sudah diperbaiki pada pemetaan di aplikasi |
| Kapan rincian muncul | `total_amount` hanya muncul setelah pembeli membayar; `escrow_amount` masih bisa berubah sebelum pesanan selesai | Angka "estimasi dana masuk" akan terisi setelah pesanan diproses/selesai — sebelum itu aplikasi menandai "belum ada rincian" |
| Urutan resi | `READY_TO_SHIP` → `LOGISTICS_READY` → `get_shipping_parameter` → `ship_order` (pilih tepat satu: pickup / dropoff / non_integrated) → status `PROCESSED` → `get_tracking_number` (bisa balas *"being allocated"*, tunggu lalu ulangi) | Aplikasi memakai urutan ini; tombol "Atur Pengiriman (Ambil Resi)" = langkah ini |
| Rekomendasi waktu | *"It's recommended to initiate logistics one hour after the orders were placed."* | Beri jeda ±1 jam sejak pesanan masuk sebelum atur pengiriman |
| Batas sinkronisasi pesanan | `get_order_list`: maksimal rentang **15 hari**, `page_size` 1–100, paginasi cursor | Sinkronisasi aplikasi berjalan tiap 60 detik dalam rentang aman |
| Push/webhook | **Opsional** untuk Go Live (kutipan: *"(Optional) If you need to subscribe to Push Mechanism notifications..."*). Bisa diuji di sandbox walau App masih Developing (Developer Guide /644). Kode push: 3 (status pesanan), 4 (nomor resi), 15 (dokumen kirim), 30 (status fulfillment) | Aplikasi sudah punya endpoint webhook + verifikasi tanda tangan; push otomatis mengalir setelah Live |
| Label resi | Label resmi Shopee: `get_shipping_document_parameter` → `create_shipping_document` → `get_shipping_document_result` → `download_shipping_document`; hanya saat pesanan `PROCESSED` | ✅ Sudah diterapkan. Aplikasi **tidak pernah** membuat label sendiri: file yang dicetak adalah file resmi Shopee apa adanya. Label karangan (dan nomor resi karangan) sudah dihapus dari kode |
| Batas laju (rate limit) | Angka per endpoint **tidak dipublikasikan**; yang resmi: `error_limit` harian (reset 00:00 UTC+8) dan `error_rate_limit` | Sinkronisasi 60 detik + webhook sudah sesuai anjuran resmi *"You're encouraged to use both"* |

---

## 7. Jebakan yang paling sering membuat gagal

| Jebakan | Pencegahan |
|---|---|
| Belum memenuhi kelayakan (Mall/Managed/≥30 order 30 hari) | Cek dulu sebelum isi formulir |
| URL produk Live kosong / tidak bisa diakses | Siapkan domain HTTPS yang benar-benar hidup |
| Username/password uji salah atau fitur tidak aktif | Pastikan akun uji bisa login dan semua menu utama bisa dibuka |
| Tangkapan layar tidak menunjukkan penggunaan data | Sertakan layar yang memperlihatkan pesanan & stok (bukan hanya halaman kosong) |
| Redirect URL Domain belum didaftarkan / masih HTTP | Daftarkan HTTPS di Console, samakan dengan yang di aplikasi |
| IP dinamis tanpa penjelasan | Pilih "IP address(es) unavailable" + alasan |
| Mengajukan Live mepet target | Review **24 jam, tidak bisa dipercepat** |
| Memakai App untuk melayani toko lain | Individual Seller **hanya untuk toko sendiri** (melayani pihak lain butuh status ISV) |

---

## 8. Sumber resmi (semua sudah saya buka)

- Kelayakan akun & pendaftaran: <https://open.shopee.com/developer-guide/12>
- App type, Go Live, status App, FAQ (24 jam, IT Assets): <https://open.shopee.com/developer-guide/14>
- Otorisasi & Redirect URL Domain: <https://open.shopee.com/developer-guide/16> , <https://open.shopee.com/developer-guide/20>
- Push Mechanism: <https://open.shopee.com/developer-guide/18>
- Uji push di sandbox: <https://open.shopee.com/developer-guide/644>
- Definisi data (metode pembayaran, alasan batal): <https://open.shopee.com/developer-guide/31>
- Alur logistik & definisi status: <https://open.shopee.com/developer-guide/229>
- API `get_order_detail`: <https://open.shopee.com/documents/v2/v2.order.get_order_detail>
- API rincian biaya: <https://open.shopee.com/documents/v2/v2.payment.get_escrow_detail>
- API logistik: <https://open.shopee.com/documents/v2/v2.logistics.get_shipping_parameter> , `.../v2.logistics.ship_order` , `.../v2.logistics.get_tracking_number`
