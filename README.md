# E-Fulfill Hub

Aplikasi operasional gudang untuk penjual Shopee **make-to-order**: pesanan
masuk → dipilih owner → produksi (bila stok kosong) → ambil barang → packing →
serahkan ke kurir → terlacak sampai diterima pembeli. Setiap aksi tercatat
**siapa pelakunya**, karena pembayaran packer & kurir internal dihitung per paket.

Produksi: `https://maktabah313.web.id` (VPS `45.126.43.98`,
`/opt/efulfill/app`, PM2 `efulfill`, port 3000; jalur darurat:
`https://45-126-43-98.sslip.io`).

## Dokumen

| Berkas | Isi |
|---|---|
| **`docs/ROADMAP.md`** | tujuan, keputusan, status, roadmap & task — **satu-satunya sumber kebenaran** |
| `deploy/RUNBOOK-OPERASIONAL.md` | prosedur darurat VPS (disk penuh, migrasi gagal, aturan status) |
| `docs/panduan-operator.md` | panduan pemakaian untuk operator gudang |
| `CLAUDE.md`, `AGENTS.md` | aturan kerja untuk agen/editor kode |

Jangan menambah berkas dokumentasi baru — perbarui salah satu di atas.

## Menjalankan lokal

```bash
npm install
cp .env.example .env          # isi DATABASE_URL, SHOPEE_*, dst.
npx prisma generate
npx prisma migrate deploy
npm run dev                   # http://localhost:3000
```

## Perintah wajib sebelum deploy

```bash
npx tsc --noEmit     # tipe
npm run lint         # eslint
npm run test         # unit test (cepat, tanpa Python)
npm run build        # build produksi
```

`npm run test:integration` — test berat (baca barcode PDF lewat Python/PyMuPDF,
±1–2 menit). Dijalankan sebelum rilis, **tidak** ikut gate harian.

## Deploy

```bash
VPS_PASS='...' uv run --with paramiko python scripts/vps-deploy-paramiko.py deploy
VPS_PASS='...' VPS_SCRIPT='vps-health.sh' \
  uv run --with paramiko python scripts/vps-deploy-paramiko.py verify
```

Helper ini mengunggah `src`+`prisma`, menjalankan `migrate deploy`, `prisma
generate`, `npm run build`, `pm2 restart`, lalu memeriksa `health`. Jangan
memakai `ssh`/`scp` biasa: kunci publik mesin pengembangan ditolak server.

## Arsitektur singkat

```
src/modules/<modul>/domain          aturan murni (tanpa I/O) + *.test.ts
src/modules/<modul>/application     usecase: transaksi & orkestrasi
src/modules/<modul>/infrastructure  Prisma, adapter Shopee
src/app/api/v1/**                   route: validasi input + izin saja
src/app/dashboard/**                UI; status/aksi datang dari server
```

Prinsip: satu sumber kebenaran per keputusan (lihat `docs/ROADMAP.md` §1), stok
jujur lewat ledger, dan UI tidak pernah menghitung status sendiri.
