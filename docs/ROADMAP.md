# Roadmap & Task — E-Fulfill Hub

**Satu-satunya sumber kebenaran** untuk tujuan, keputusan, status pekerjaan, dan
sisa pekerjaan. Dokumen lain di repo:

| Dokumen | Isi |
|---|---|
| `README.md` | cara menjalankan, menguji, dan men-deploy |
| `deploy/RUNBOOK-OPERASIONAL.md` | prosedur darurat VPS (disk, migrasi, status) |
| `docs/panduan-operator.md` | panduan pemakaian untuk operator gudang |
| `CLAUDE.md` / `AGENTS.md` | aturan kerja untuk agen/editor kode |

Selain itu **tidak ada** dokumen lain. Kalau ada informasi baru, tambahkan ke
salah satu dari empat berkas di atas — jangan membuat berkas baru.

Terakhir diperbarui: 2026-10-28.

---

## 1. Tujuan produk

Aplikasi operasional gudang untuk penjual Shopee **buatan sendiri (make to
order)**: pesanan masuk → dipilih & divalidasi owner → kalau barang belum ada
diproduksi dulu → diambil dari gudang → dipacking → diserahkan ke kurir →
diterima kurir Shopee → diterima pembeli. Semua langkah harus **tercatat siapa
pelakunya**, karena pembayaran packer dan kurir internal dihitung **per paket**.

Prinsip yang tidak boleh dilanggar:

1. **Satu sumber kebenaran per keputusan.** Status paket ditentukan
   `shipments.status`; pekerjaan gudang ditentukan `fulfillment_orders.status`.
   Kalau bertentangan, paket yang menang (barangnya sudah keluar gudang).
2. **Stok jujur.** Tidak ada "berhasil" tanpa baris ledger. Stok minus adalah
   kejadian nyata yang harus terlihat, bukan disembunyikan.
3. **Setiap aksi punya aktor.** `audit_logs.actorId` wajib terisi; laporan
   per-orang dibangun dari situ.
4. **UI hanya menampilkan yang boleh dilakukan.** Server tetap penjaga terakhir
   (`assertPermission`), UI tidak boleh menebak.

---

## 2. Kondisi yang sudah berjalan (terverifikasi di produksi)

| Hal | Bukti |
|---|---|
| Kartu kerja: Baru / Sudah Ada Resi / Perlu Diproses | 24 + 6 = 30 (selaras Seller Centre) |
| Kartu pembatalan & keterlambatan | Diajukan 1 · Batal Sistem 29 · Terlambat 1 · Besok Batal 1 · Beresiko 17 |
| Scan paket in-transit | `ALREADY_IN_TRANSIT`, `stockDeducted: false` |
| Anomali paket sudah jalan tapi catatan tertinggal | **0** (74 ditutup, idempoten) |
| Filter tanggal WIB (hari ini/kemarin/7/30/semua) | terbukti menyaring (0/5/22/32) |
| Badge menu = kartu Perlu Diproses | 29 = 29 |
| Layout ponsel 360/393/414 px | 11 halaman × 3 lebar: 0 geser mendatar |
| Tema terang/gelap | token CSS + `data-theme`, kontras AA |
| Gate | `tsc` 0 · `lint` 0 (0 warning) · **421 test lulus** · build OK |
| Stok | dikosongkan oleh owner: 23 varian / 132 unit → semua 35 varian = 0 |
| Produksi | halaman Produksi + PDF nama pendek, bisa pilih pesanan |
| VPS | `efulfill:online`, `health 200`, schema up to date, disk 10% |

---

## 3. Keputusan yang sudah dikunci

| # | Keputusan | Alasan |
|---|---|---|
| D1 | Status mentah Shopee (`external_status`) disimpan dan dipakai untuk klasifikasi | `READY_TO_SHIP` vs `PROCESSED` tidak bisa dibedakan dari status internal |
| D2 | `cancel_by` + `cancel_reason` + waktu pembatalan disimpan | Membedakan batal pembeli / penjual / sistem |
| D3 | **Tidak ada role selain OWNER.** Hak akses diberikan per akun lewat izin | Satu orang bisa merangkap packer + kurir; bayaran keduanya dihitung |
| D4 | **Pembayaran per paket: hanya jumlah, tanpa nominal rupiah** (ditunda) | Tarif belum diputuskan klien |
| D5 | **"Tolak pembatalan" tidak ditampilkan.** Hanya "Setujui" | Shopee v2 tidak punya API menolak pembatalan pembeli |
| D6 | Menyetujui pembatalan = `order/cancel_order`, tercatat `cancel_by=seller` | Bawaan API; disetujui owner. Hanya OWNER yang boleh |
| D7 | **Stok per jilid dan stok set TERPISAH** — tidak ada konversi/penambalan | Klien memproduksi ulang per jilid; set adalah stok jadi sendiri |
| D8 | **Saldo awal stok tidak diimpor** oleh aplikasi | Owner mengisi sendiri |
| D9 | Batal sistem karena `Unpaid Order` tidak dihitung "perlu perhatian" | Bukan kegagalan gudang |
| D10 | Banding/resi simulasi dilarang; angka harus berasal dari API/ledger | Kejujuran data |
| D11 | Retensi binlog MySQL **2 hari**; server tanpa replikasi | Sempat 34 GB → disk penuh, deploy gagal |
| D12 | Test integrasi berat (Python/PyMuPDF) dipisah: `npm run test:integration` | Gate harian harus cepat & deterministik |
| D13 | Panel saran urutan kerja **dibatalkan**; diganti halaman Produksi (pilih → cetak) | Klien menilai panel membingungkan dan menduplikasi kerja otomatis |
| D14 | **Stok per jilid terpisah** dari stok SET; tidak ada konversi otomatis | Klien memproduksi ulang per jilid, SET adalah barang jadi sendiri |
| D15 | Stok boleh **negatif** di sistem dan boleh dikoreksi dari negatif ke 0 | Barang sudah dikirim sebelum aplikasi dipakai; menolak angka negatif membuat koreksi mustahil |
| D16 | Stok awal **dikosongkan** (23 varian / 132 unit) lalu diisi owner sendiri | Angka lama tidak mencerminkan stok fisik |

---

## 4. Model status (ringkas)

```
Pesanan (orders)
  status internal : NEW → CONFIRMED → CANCELLED / COMPLETED
  external_status : UNPAID|PENDING|READY_TO_SHIP|PROCESSED|RETRY_SHIP|SHIPPED|
                    TO_CONFIRM_RECEIVE|IN_CANCEL|CANCELLED|TO_RETURN
  cancel_by       : buyer | seller | system | Ops

Pekerjaan gudang (fulfillment_orders)
  WAITING_STOCK → READY_TO_PICK → PICKING → PICKED → PACKING → PACKED
                → READY_TO_SHIP → HANDED_OVER → COMPLETED        (+ EXCEPTION)

Paket (shipments)
  PENDING → READY_TO_SHIP → PICKED_UP → IN_TRANSIT → DELIVERED   (+ FAILED/RETURNED)
```

Aturan tampilan: pesanan yang paketnya sudah `PICKED_UP`/`IN_TRANSIT`/
`DELIVERED` **tidak pernah** masuk antrean kerja, dan scan resinya tidak
menyentuh stok.

---

## 5. Roadmap

### Fase 1 — Persetujuan pembatalan oleh owner (selesai, kecuali uji happy-path)
- [x] `POST /api/v1/orders/[orderId]/cancellation` — izin `order.cancel` **dan** peran OWNER
- [x] Adapter Shopee: `order/cancel_order` (`order_sn`, `cancel_reason: OTHERS`)
- [x] Aturan murni `domain/cancellation.ts` + 7 test (bukan owner, bukan pengajuan, sudah final, paket sudah jalan)
- [x] Audit `buyer_cancellation_approved` + pelepasan reservasi stok pesanan itu
- [x] Tombol "Setujui pembatalan" hanya tampil bila server mengirim `izin.setujuiPembatalan`;
      tombol "Tolak" **tidak ada** (D5)
- [x] Terverifikasi di produksi: `izin.setujuiPembatalan=true` untuk owner, dan endpoint
      menolak dengan pesan jelas saat pesanan bukan pengajuan (HTTP 422)
- [ ] **Uji happy-path** (pesanan benar-benar batal dengan `cancel_by=seller`) menunggu
      ada pengajuan baru — saat verifikasi, satu-satunya pengajuan sudah dibatalkan
      Shopee sendiri (`cancel_by=buyer`) karena melewati tenggat tanggapan
- **Temuan penting:** pengajuan pembatalan pembeli punya tenggat. Kalau owner tidak
  menanggapi, Shopee menyetujuinya sendiri (`cancel_by=buyer`). Karena itu kartu
  "Pembatalan Diajukan" harus ditindaklanjuti hari itu juga.

### Fase 2 — Jejak aktor per tahap (selesai)
- [x] Kolom `pickedById/pickedAt`, `packedById/packedAt`, `handedOverById/handedOverAt`
      + indeks untuk laporan per-orang
- [x] Diisi oleh usecase aksi (picking, packing, handover), bukan hanya audit log
- [x] Dikirim ke UI sebagai `order.aktor` (id + nama) dan ditampilkan di kartu pesanan
- [x] Terverifikasi: migrasi `MIGRATE=0`, kolom terpasang, 344 test lulus
- Catatan: pesanan **lama** tidak punya jejak ini (kolomnya baru) — terisi untuk aksi
  berikutnya, bukan hasil backfill.

### Fase 3 — Ringkasan operasional owner (selesai)
- [x] `GET /api/v1/reports/operations?range=` + `domain/operation-metrics.ts` (7 test)
- [x] Kartu keadaan sekarang: Perlu Produksi · Siap Diambil · Sedang Dipacking · Siap Diserahkan · Gagal
      (angka "diterima kurir Shopee" dipisah karena itu kejadian, bukan keadaan)
- [x] Kejadian dalam rentang: dipacking · diserahkan · diterima kurir Shopee — disaring
      **tanggal kejadian** (packedAt / handedOverAt), bukan tanggal pesanan
- [x] Tabel per pelaku: paket dipacking & diserahkan per orang (D4: jumlah saja, tanpa rupiah)
      + penanda `tanpaNama` untuk data lama agar laporan tidak terlihat lebih rapi dari kenyataan
- [x] Tampil di halaman Laporan (izin `page.reports`), tanpa menu baru
- [x] Terverifikasi produksi: `range=today` → perlu produksi 50 · siap diambil 19 · gagal 10 ·
      diterima kurir Shopee 25; `range=all` → dipacking 166 · diserahkan 166 (semuanya `tanpaNama`,
      karena kolom aktor baru ada)
- Catatan UX: jejak aktor **tidak** ditampilkan di kartu antrean kerja (mengganggu saat
  memproses); tempatnya di halaman Laporan & detail pesanan. Data tetap dikirim API.
- [ ] Tabel jejak per pesanan (timeline) — menyusul bersama Fase 5
- Ukur keberhasilan: angka `hari ini` cocok dengan hitungan manual satu hari kerja.

### Fase 4 — Pemilihan pesanan oleh owner (DIBATALKAN, diganti halaman Produksi)
Panel "saran urutan kerja + kerjakan/tunda" sempat dibuat, lalu **dihapus** karena
pemilik toko menilai membingungkan dan menduplikasi pekerjaan yang sudah otomatis
dilakukan sinkronisasi Shopee. Yang dipertahankan hanya intinya: **pilih pesanan →
cetak lembar produksi** (lihat Fase 5).
- [x] Kode dihapus: `selection-panel.tsx`, route `fulfillment/selection`,
      `selection.usecase.ts`, `domain/owner-selection.ts` + test
- [x] Kolom `deferred_until` / `defer_reason` / `deferred_by_id` dibuang lewat migrasi
      `20261020090000_drop_order_defer` (tidak pernah dipakai di produksi)

### Fase 5 — Daftar produksi (PDF) (SELESAI)
- [x] **Pelacakan batch produksi** (`ProductionBatch`, migrasi `add_production_batch`):
      setiap cetakan tercatat `PROD-YYYYMMDD-N` + isi (himpunan pesanan) + jumlah +
      aktor. Deteksi cetak ulang: set pesanan identik di hari yang sama →
      `duplikat=true`, TIDAK membuat baris baru (anti produksi ganda); pemilihan
      berbeda → batch baru. UI menampilkan "Terakhir dicetak" di judul halaman dan
      peringatan "jangan produksi dua kali" saat cetak ulang.
      Terverifikasi produksi: cetak-sama 3x → 1 batch; cetak-2-pesanan → batch ke-2
      (`PROD-20261023-1` dan `PROD-20261023-2`).
- [x] `GET /api/v1/fulfillment/production-list` → PDF A4 (`pdf-lib`), hanya FO `WAITING_STOCK`
- [x] Dikelompokkan **per SKU** dengan total unit, di dalamnya daftar pesanan urut batas kirim
- [x] Kolom tanda tangan "diserahkan / diterima tim produksi" + kode batch harian (`PROD-YYYYMMDD`)
- [x] `amanUntukPdf()` membersihkan karakter di luar Latin-1 (emoji, kutip melengkung) — tanpa ini
      `pdf-lib` melempar error dan seluruh dokumen gagal
- [x] Audit `production_list_printed` setiap unduhan
- [x] **Halaman Produksi** (`/dashboard/produksi`, izin `page.production`): daftar dikelompokkan,
      bisa **centang pesanan mana saja** yang mau dicetak, "Cetak terpilih" / "Cetak semua"
- [x] **Nama pendek** sesuai permintaan pemilik: `Abu Daud Jilid 1` · `Abu Daud Set` · `ALQURAN COMBI` ·
      `ALQURAN POCKET` · `Muslim Set` · `Tirmidzi Jilid 5` · `Ibnu Majah Set` · `Nasai Set` ·
      `Bukhori Jilid 6` · `Bukhori Set` (15 kasus diuji, termasuk varian salah ketik "Jilid i" → Jilid 1)
- [x] **Urutan: SET dulu**, lalu jilid 1,2,3,… (diuji)
- [x] PDF disederhanakan: **Produk · Qty · Tanggal** + tanda tangan; **satu baris per produk**
      (semua resi dengan produk sama digabung, qty dijumlahkan, "2 resi" dicatat kecil di bawah nama)
- [x] Urutan **dua tingkat**: (1) SELURUH produk SET lebih dulu, urut merek;
      (2) baru semua per-jilid, urut merek lalu jilid menaik — sehingga Muslim Jilid 1
      tepat di atas Muslim Jilid 2, 3, 4.
      Terverifikasi produksi: `Abu Daud Set → Bukhori Set → Ibnu Majah Set → Muslim Set →
      Tirmidzi Set → Abu Daud Jilid 1 → Bukhori Jilid 1,2,4,5,6 → Ibnu Majah Jilid 1,3 → …`
- [x] Kolom tanggal menampilkan **rentang** bila pesanannya beda hari (mis. `27 Sep .. 6 Okt`)
- [x] Terverifikasi produksi: 51 pesanan/67 unit, urutan `Abu Daud Set → Bukhori Set → … → Abu Daud Jilid 1`;
      cetak 3 pesanan terpilih → PDF 1.699 byte (bukan seluruh daftar)
- [ ] Pelacakan batch (tabel `production_batches`) agar cetak dua kali tidak memicu produksi ganda

### Fase 6 — Perapian & operasional (selesai)
- [x] Hapus route `historical-sync` + tombol "Tarik Data Historis"
- [x] Hapus 12 skrip sekali-pakai; sisakan `vps-health.sh` + helper deploy
- [x] Purge binlog + retensi 2 hari (disk 100% → 10%)
- [x] Pisahkan test integrasi dari gate harian
- [x] `pm2-logrotate`: 10 MB per berkas, simpan 5, kompres, rotasi harian (`scripts/vps-setup-logrotate.sh`)
- [x] Cek disk mingguan otomatis (cron) — alatnya sudah ada: `scripts/vps-health.sh`
- [x] Backfill `external_status` **tidak perlu** (0 pesanan aktif tanpa status — terukur)
- [x] **Ringkasan operasional dipindah dari Laporan ke halaman Pesanan** (issue user):
  - Section `OperasionalSection` lama dicabut dari `laporan/page.tsx` (sebelumnya
    tersarang di dalam `<button>` aksi `PageHeader` — HTML invalid, tombol & chip
    bocor keluar, layout rusak).
  - Komponen baru `OperasionalSectionPesanan` di `dashboard/pesanan/operasional-section.tsx`:
    grup "Keadaan SEKARANG" (5 kartu: Perlu Produksi, Siap Diambil, Sedang Dipacking,
    Siap Diserahkan, Gagal/Tertahan) + grup "Kejadian DALAM RENTANG" (Dipacking,
    Diserahkan ke kurir, Diterima kurir Shopee), tiap kartu berlabel + hint definisi,
    filter rentang Hari ini/Kemarin/7 hari/30 hari/Semua, gate `page.reports`.
  - Bug kritis saat deploy: versi lama komponen menaruh `if (!can('page.reports')) return null`
    SEBELUM hook `useState`/`useEffect` → React #310 (hooks berubah antar render) →
    seluruh halaman Pesanan error "This page couldn't load". Diperbaiki: semua hook
    dipanggil sebelum gate. Verifikasi produksi: halaman render penuh, console 0 error,
    filter kemarin mengubah angka (12 → 13 diterima Shopee).
  - Test domain `operation-metrics.test.ts`: 7 test `hitungTahap` & `TAHAP_OPERASIONAL`.
  - Bukti gate: `tsc` 0 error, `lint` 0 error, test 396 passed, HEALTH=200, DEPLOY_OK.

---

### Fase 7 — Section "Paling dekat dibatalkan otomatis" + perbaikan data (selesai)
- [x] Section di atas daftar produk: **5 pesanan dengan batas kirim terdekat**,
      kolom Produk · Qty · Batas kirim · Sisa waktu; nada warna: lewat/kritis/waspada/aman.
      Unit murni `src/modules/fulfillment/domain/countdown.ts` (hitung dalam menit agar
      sisa <1 jam tidak salah baca "0 jam") + 7 test.
- [x] **Anomali produksi**: 28 pesanan yang SUDAH batal di Shopee masih berstatus
      `WAITING_STOCK` (51 → 23 pesanan, 67 → 31 unit, 21 → 13 baris produk).
      Akar masalah: webhook `order_status_push` hanya memperbarui `order.status` dan
      tidak menutup `FulfillmentOrder` (jalur `importOrder` sudah benar sejak awal).
      Solusi: webhook kini memanggil `releaseReservationsForOrder` +
      `markFulfillmentOrdersException` (idempoten); `importOrder` juga menyembuhkan
      data batal lama (kondisi `existing.status !== 'CANCELLED'` dihapus — idempoten);
      data lama dibereskan lewat `scripts/backfill-tutup-fulfillment-batal.sh`
      (crash-safe per pesanan): 9 baris terakhir ditutup, `WAITING_STOCK` = 14,
      yatim = 0.
- [x] **Definisi daftar produksi = antrean kerja (badge)**. Dulu hanya `WAITING_STOCK`
      sehingga beda dengan angka "Perlu Diproses" di menu (28). Kini pemilihan memakai
      `classifyWorkQueue` yang sama dengan halaman Pesanan: pesanan batal keluar,
      pesanan stok-ada (SIAP_DIKEMAS) ikut masuk. Terverifikasi produksi:
      `daftar produksi = 28 pesanan / 38 unit / 14 baris` = angka badge.
- [x] **Verifikasi sumber kebenaran**: full-sync dari Shopee setelah perbaikan →
      `orders: COMPLETED, recordsWritten=0` — 23 pesanan tersisa memang masih CONFIRMED
      menurut API Shopee; 5 di antaranya sudah lewat `shipByAt` = isi section (prioritas
      pertama tim produksi).

### Fase 8 — Pesanan batal, Lacak Kiriman, dan antrean kerja otomatis (selesai & teruji)

Delapan cycle dikerjakan berurutan, tiap cycle ditutup dengan validasi sebelum
lanjut ke cycle berikutnya.

- [x] **Cycle 1 — Ringkasan operasional tanpa kartu "gagal".**
      `operation-metrics.ts` tidak lagi menjadikan `EXCEPTION` sebagai kartu
      kegagalan, dan `hitungTahap` dijaga terhadap status tak dikenal.
      11 test domain.
- [x] **Cycle 2 — Kejadian Shopee memakai tanggal stabil.**
      `operations.usecase.ts` menghitung "diterima kurir Shopee" dari
      `handedOverAt`/`packedAt`, bukan dari tanggal pesanan — angka tidak lagi
      bergeser saat rentang tanggal diganti.
- [x] **Cycle 3 — Station API menerima `?tahap=`.**
      Klik kartu ringkasan menyaring daftar; nilai tak dikenal diabaikan ke
      default yang aman, bukan diteruskan.
- [x] **Cycle 4 — Halaman Pesanan dirapikan.** Kartu antrean di atas, ringkasan
      operasional di bawahnya dan mengikuti filter halaman, kartu dapat diklik,
      kelompok Shopee vs aplikasi dipisah. Section yatim di halaman Laporan
      dihapus (193 baris) beserta bug JSX tombol-dalam-tombol.
      Bukti: tsc 0, 400 test.
- [x] **Cycle 5 — Pesanan batal bukan "Gagal kirim".** Akar masalah di data:
      `mapLogisticsStatus()` dipakai untuk status pesanan *dan* status paket,
      sehingga `CANCELLED` ditulis sebagai `FAILED`.
      - enum `ShipmentStatus.CANCELLED` (migrasi `20261028090000`, aditif)
      - `shipping/domain/shipment-status.ts`: `mapOrderStatusToShipment` +
        `shouldAdvanceShipmentStatus` (satu sumber aturan)
      - sinkronisasi, webhook, scan resi, dan badge kartu memakai pemetaan itu;
        AWB yang datang setelah pembatalan tidak membuat pengiriman baru
      - migrasi memperbaiki data lama **hanya** untuk paket tanpa jejak
        `PICKED_UP`/`IN_TRANSIT`/`DELIVERED`
      - UI: chip `Gagal Kirim` / `Dikembalikan` / `Dibatalkan` dipisah — `FAILED`
        sebelumnya tidak bisa disaring sama sekali
      - Bukti E2E DB nyata: 1 baris diperbaiki, paket berjejak tetap `FAILED`,
        dijalankan ulang = 0 baris
- [x] **Cycle 6 — Catatan fulfillment otomatis.** Dulu hanya untuk pesanan yang
      baru diimpor (`result.created`), sehingga pesanan lama yang baru menjadi
      siap kerja (mis. `UNPAID` → `READY_TO_SHIP`) tidak pernah masuk antrean
      kerja maupun daftar produksi.
      - domain `fulfillment-gate.ts` (7 test) + `ensureFulfillmentForOrder()`
      - dipanggil sinkronisasi **dan** webhook saat status menjadi `CONFIRMED`
      - idempoten; sengaja tidak membuat catatan untuk pesanan batal, belum
        dibayar, paket yang sudah keluar gudang, atau catatan yang sudah ada
      - Bukti E2E DB nyata: 5 skenario lulus (dibuat, idempoten, batal, in-transit,
        unpaid)
- [x] **Cycle 7 — Gate penuh.** `tsc` 0 error · `lint` 0 error 0 warning ·
      **421 test lulus** (naik dari 396 di awal) · `build` OK.
      Catatan: halaman Laporan memakai `LoadingState`/`ErrorState` yang selama ini
      diimpor tetapi tidak pernah dirender — kegagalan API tampil sebagai tabel
      kosong tanpa penjelasan.
- [x] **Cycle 8 — Dokumentasi.** `deploy/RUNBOOK-OPERASIONAL.md` §8–§9 (gejala,
      akar, cara memeriksa di VPS, batas perbaikan data) dan bagian ini.
- [x] **Deploy produksi + verifikasi angka nyata** (2026-10-28).
      `DEPLOY_OK`, `HEALTH=200`, schema *up to date*.
      Angka produksi saat verifikasi:
      - paket milik pesanan dibatalkan: **47 `CANCELLED`**, sisa `FAILED` tanpa
        jejak perjalanan: **0**
      - `?status=CANCELLED` = 47 · `?status=RETURNED` = 2 · `?status=FAILED` = 0
      - pesanan siap kerja tanpa catatan fulfillment: **0**
      - kartu antrean: `perluDiproses 23 (baru 16 + sudahResi 7)`; filter tahap
        `perluProduksi` = 23 (sama dengan kartu)
      - halaman Lacak Kiriman: HTTP 200, chip `Gagal Kirim` / `Dikembalikan` /
        `Dibatalkan` tampil, 0 error React
- [x] **Perbaikan susulan: `?status=ALL` membalas kosong.** Ditemukan justru
      saat verifikasi produksi (191 kiriman, tapi `status=ALL` → 0). Penyebabnya
      cast TypeScript `as ShipmentStatus` yang tidak berlaku saat berjalan,
      sehingga nilai asing sampai ke Prisma. `getEnumQueryParam()` sekarang
      dipakai `/api/v1/shipments`, `/api/v1/returns`, `/api/v1/orders`.
      Terverifikasi di produksi: `status=ALL` = 191 = tanpa filter.

## 6. Aturan kerja (untuk agen & editor)

1. Domain murni di `src/modules/*/domain` — tanpa Prisma, tanpa HTTP; wajib ada test.
2. Usecase memegang transaksi; route hanya memvalidasi input + izin.
3. UI tidak menghitung status/aksi sendiri — server mengirim `workflow`, `stage`,
   `lateRisk`, `cancelCategory`.
4. Setiap aksi yang mengubah data menulis `auditLog` dengan `actorId`.
5. Gate sebelum deploy: `npx tsc --noEmit`, `npm run lint`, `npm run test`,
   `npm run build`. Berat: `npm run test:integration` sebelum rilis.
6. Deploy: `VPS_PASS=... uv run --with paramiko python scripts/vps-deploy-paramiko.py deploy`.
   Jangan memakai `ssh`/`scp` biasa (kunci publik ditolak server).
7. Jangan menambah berkas dokumentasi baru. Perbarui berkas di tabel atas.
