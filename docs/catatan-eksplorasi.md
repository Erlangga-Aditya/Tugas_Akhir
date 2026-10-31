# Eksplorasi Ulang Sistem — 31 Okt 2026

Workspace: `C:\Users\Erlan\Downloads\clone Tugas Akhir\Tugas_Akhir`
HEAD `209dddd` = remote `origin/main` (tersinkron, 19 commit, 1 kontributor Erlangga-Aditya).
File tidak ter-commit: `next-env.d.ts` (M), `AGENTS.md` `CLAUDE.md` (untracked).

## Yang baru sejak `e60bcb1` (13 commit terakhir)

| Commit | Isi |
|---|---|
| `209dddd` | feat(ui): tombol mata lihat/sembunyikan password |
| `f830963` | feat(laporan): nama hari di header tabel & dropdown tahun dari data |
| `c8e3159` | feat(laporan): ringkas judul rekap & sembunyikan tanggal kosong |
| `11790f7` | feat(kelola-tim): owner mengedit nama, email, dan password staf |
| `b5e38d6` | fix(resi): resi tidak tersimpan + drop-off tanpa cabang + skrip diagnostik |
| `96b1010` | refactor(pesanan): hapus Ringkasan Operasional Gudang dari halaman Pesanan |
| `61ecab1` | fix(pesanan): label tombol urut sesuai logika (tenggat, bukan waktu pesan) |
| `5482a48` | feat(reports): rekap kerja staf per minggu gaji |
| `9743a7b` | docs: perbarui README, ROADMAP, RUNBOOK, panduan deploy |
| `24f509d` | docs: perbaiki daftar dokumen di ROADMAP |
| `288aa1c` | chore: bersihkan dokumentasi usang |
| `c92bffb` | fix(pengiriman): pesanan batal bukan 'Gagal kirim'; fulfillment otomatis & status resi asing |
| `28a51ea` | feat(produksi): modul produksi & pelacakan batch cetak; setujui pembatalan pembeli; ringkasan operasional pindah ke Pesanan |

## Modul/domain baru (lokasi berkas)

### 1. Modul Produksi (baru)
- Halaman: `src/app/dashboard/produksi/page.tsx` (menu "Produksi", izin `page.production`)
- API: `src/app/api/v1/fulfillment/production-list/route.ts`
- Aplikasi: `src/modules/fulfillment/application/production-batch.ts` — `catatPencetakan()`, `ambilCetakanTerakhir()`
- Domain: `src/modules/fulfillment/domain/production-batch.ts` — `kunciCetak()`, `buatKodeBatch()` (`PROD-YYYYMMDD-N`), `awalHari()`
- Aturan anti-ganda: cetakan ulang dengan himpunan orderIds identik di hari kalender yang sama → `duplikat: true`, TIDAK membuat baris `production_batches` baru
- Kode `PROD-20261031-1` tercatat di endpoint (1 pesanan, 1 unit) tapi tabel `production_batches` masih 0 baris → kode batch dibuat on-the-fly, belum ada cetakan tersimpan
- Data dikelompokkan per produk + jilid; urutan: produk SET lebih dulu, lalu jilid 1,2,3…; daftar "mendesak" dengan nada `lewat/kritis/waspada/aman`

### 2. Persetujuan pembatalan pembeli (baru)
- API: `POST /api/v1/orders/[orderId]/cancellation` body `{"operation":"ACCEPT"}`
- Hanya `ACCEPT`: Shopee Open Platform v2 tidak punya endpoint tolak; halaman `/dashboard/operasi` dipindah → redirect ke `/dashboard/pesanan`
- Domain: `src/modules/orders/domain/cancellation.ts` — `checkCancelApproval()`: role harus OWNER, orderStatus bukan final, `externalStatus` harus `IN_CANCEL`, paket tidak boleh sudah jalan
- Pelaku: `cancel_by` = `buyer|seller|system|ops`; kategori: DIAJUKAN / DIBATALKAN_PEMBELI / DIBATALKAN_PENJUAL / DIBATALKAN_SISTEM
- Izin: `order.cancel` + peran OWNER
- `isSystemCancelNeedsAttention()`: alasan pembatalan sistem yang mengandung `UNPAID` (pembeli tidak bayar) TIDAK ditampilkan di kartu perhatian

### 3. Penyederhanaan status paket (fix Fase 8)
- `src/modules/shipping/domain/shipment-status.ts`:
  - `mapOrderStatusToShipment()` — pesanan `CANCELLED` → paket `CANCELLED` (bukan `FAILED`); `IN_CANCEL` → `null` (jangan tulis apa-apa)
  - `shouldAdvanceShipmentStatus()` — status paket hanya boleh MAJU; `CANCELLED` hanya sah bila paket belum keluar gudang
  - `SHIPMENT_LEFT_WAREHOUSE`, `SHIPMENT_TERMINAL`
- `src/modules/fulfillment/domain/fulfillment-gate.ts` — `shouldCreateFulfillmentRecord()`: paket sudah keluar gudang → tidak buat fulfillment record baru

### 4. Kartu "perlu perhatian" + antrean kerja (baru)
- `src/modules/fulfillment/domain/order-exceptions.ts`:
  - `ExceptionKategori`: `pembatalan`, `batalSistem`, `terlambat`, `besokBatal`, `beresiko`
  - `resolveLateRisk()`: `TERLAMBAT` (sisa ≤0), `BESOK_BATAL` (READY_TO_SHIP & sisa ≤24j), `BERESIKO` (sisa ≤24j/≤3 hari), `AMAN`
- `src/modules/fulfillment/domain/work-queue.ts`:
  - `classifyWorkQueue()` — pakai `externalStatus` (status mentah Shopee) dulu, baru cadangan tahap internal
  - bucket: `baru` (READY_TO_SHIP), `sudahResi` (PROCESSED/RETRY_SHIP), `perluDiproses` (gabungan)
  - `EXTERNAL_NOT_IN_QUEUE`: UNPAID/PENDING/IN_CANCEL/TO_RETURN/SHIPPED/TO_CONFIRM_RECEIVE/COMPLETED/CANCELLED
  - pesanan batal (status internal NEW) TIDAK dihitung sebagai pekerjaan
- `src/modules/fulfillment/application/order-queue.usecase.ts` — TTL cache 15 detik per (tenant + rentang tanggal); `invalidateOrderQueue()`

### 5. Workflow operator (yang sudah diketahui, sekarang lengkap)
- `src/modules/fulfillment/domain/operator-workflow.ts`:
  - `OperatorStage`: BARU / MENUNGGU_STOK / SIAP_DIKEMAS / SIAP_KIRIM / DIKIRIM / DIBATALKAN / SELESAI
  - `resolveOperatorStage()` dari (orderStatus, fulfillmentStatus, shipmentStatus)
  - `deriveOperatorWorkflow()` → aksi: ARRANGE_SHIPMENT / PROCESS_ORDER / ADD_STOCK / SCAN_AWB / HANDOVER / NONE
  - Pesanan batal & final → `noAction()` (tidak ada tombol apa pun)

### 6. Laporan: minggu gaji & ringkasan operasional
- `src/modules/reports/domain/minggu-gaji.ts` — potong bulan jadi 4 minggu (1–7, 8–14, 15–21, 22–akhir), zona WIB
- `src/modules/reports/application/operations.usecase.ts` — `OperasionalRingkas`: tahap! saat ini, kejadian di aplikasi (dipacking/diserahkan), kejadian Shopee (`shippedAt` stabil, bukan `updatedAt`)

### 7. Hak akses (update)
- `DEFAULT_STAFF_PERMISSIONS` (11): page.dashboard/orders/inventory/products/shipping + order.prepare_shipment/pick/pack/handover + inventory.receive + shopee.sync
- `page.production` tidak untuk staf default; `OWNER_ONLY`: page.team, team.manage, page.finance, finance.view, settings.manage
- Fungsi `can()`: OWNER bebas; role bukan STAFF → tolak (fail-closed)

### 8. Menu sidebar (12)
Ringkasan, Pesanan & Pengiriman, Stok Gudang, Produk, **Produksi (baru)**, Lacak Kiriman, Pengembalian, Laporan, Laporan Keuangan, Hubungkan Shopee, Kelola Tim, Pengaturan

## Pengecekan runtime (server `npm start` di :3000, hidup)

Endpoint GET dengan cookie owner:
- `/api/v1/fulfillment/production-list` → 200, `kodeBatch: PROD-20261031-1`, 1 pesanan, grup per jilid
- `/api/v1/orders/badge` → 200, `{count:1, notQueued:1, belumResi:1, sudahResi:0}`
- `/api/v1/fulfillment/station` → 200, kartu `{perluDiproses:1, pesananBaru:1, sudahResi:0}`, perhatian `{pembatalanDiajukan:0, batalSistem:5, terlambat:1, besokBatal:0, beresiko:2}`, anomali `{paketJalanBelumDitutup:0}`
- `POST /api/v1/fulfillment/reconcile-shipped` → 200, `{diperiksa:18, perluDitutup:0, ditutup:0, dilewati:18}`
- `/api/v1/auth/me` → owner punya `page.production:true`

## Database (MySQL lokal, `efulfillhub`)
orders=45, inventory_balances=10, production_batches=0, fulfillment_orders=34, shipments=35, sync_runs=4459, users=5, stock_reservations=47, picking_tasks=34, packing_tasks=19, returns=0, webhook_events=0

Tabel `production_batches` ada (sudah dimigrasi) tapi kosong — kode batch di endpoint dibuat on-the-fly; baru disimpan saat cetak PDF benar-benar dipanggil.
