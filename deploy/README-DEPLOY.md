# Panduan Deployment E-Fulf Hub (VPS)

Dokumen ini menjelaskan cara memasang, memperbarui, dan merawat aplikasi di VPS.
Semua perintah dijalankan lewat SSH sebagai `root`.

---

## 1. Ringkasan yang dipasang

| Bagian | Keterangan |
|---|---|
| Lokasi aplikasi | `/opt/efulfill/app` |
| Manajer proses | PM2, nama proses `efulfill` (otomatis hidup lagi setelah server restart) |
| Aplikasi | Next.js production (`next start`) di port `3000` (hanya lokal) |
| Web server | Nginx sebagai pintu depan (port 80/443) + SSL Let's Encrypt (otomatis diperbarui) |
| Database | MySQL 8, database `efulfillhub`, pengguna `efulfill` |
| Zona waktu | Asia/Jakarta (supaya tanggal pesanan & laporan benar) |
| Konfigurasi rahasia | `/opt/efulfill/app/.env` (hak akses hanya root) |

Alamat aplikasi saat ini: `https://103-178-174-224.sslip.io`
(hostname berbasis IP gratis, dipakai karena domain belum dibeli — SSL-nya sah dan
diperbarui otomatis. Bisa diganti ke domain sendiri kapan saja, lihat bagian 4.)

---

## 2. Memperbarui aplikasi setelah ada perubahan kode

Dari komputer Anda (folder proyek):

```bash
SSHPASS='<sandi root>' VPS_HOST=103.178.174.224 \
  uv run --with paramiko python deploy/remote_deploy.py
```

Skrip itu aman dijalankan ulang: bagian instalasi akan dilewati, database tidak
dihapus, dan seed produksi tidak menggandakan akun.

### Pembaruan cepat (tanpa menjalankan seluruh skrip)

Dari dalam server:

```bash
cd /opt/efulfill/app
git pull                      # bila memakai git
npm ci --no-audit --no-fund
npx prisma migrate deploy
npm run build
pm2 restart efulfill
pm2 logs efulfill --lines 50
```

---

## 3. Pemeriksaan & perawatan sehari-hari

```bash
pm2 status                    # keadaan aplikasi
pm2 logs efulfill --lines 100 # log aplikasi (termasuk sinkronisasi otomatis Shopee)
pm2 restart efulfill          # mulai ulang aplikasi
systemctl status nginx        # keadaan web server
systemctl status mysql        # keadaan database
nginx -t                      # uji konfigurasi nginx
tail -f /var/log/nginx/error.log
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/login   # harus 200
```

### Cadangan database (lakukan berkala)

```bash
mkdir -p /root/backup
mysqldump --single-transaction efulfillhub | gzip > /root/backup/efulfillhub-$(date +%F).sql.gz
```

### Memulihkan cadangan

```bash
gunzip -c /root/backup/efulfillhub-2026-09-24.sql.gz | mysql efulfillhub
pm2 restart efulfill
```

---

## 4. Mengganti ke domain sendiri (setelah domain dibeli)

Misal domain: `gudang.namadomain.com` → arahkan **A record** ke `103.178.174.224`.

```bash
# 1. Tambahkan konfigurasi nginx untuk domain baru
sed 's/103-178-174-224.sslip.io/gudang.namadomain.com/' \
  /etc/nginx/sites-available/efulfill > /etc/nginx/sites-available/efulfill-domain
ln -s /etc/nginx/sites-available/efulfill-domain /etc/nginx/sites-enabled/efulfill-domain
nginx -t && systemctl reload nginx

# 2. Terbitkan sertifikat SSL untuk domain baru
certbot --nginx -d gudang.namadomain.com --non-interactive --agree-tos --redirect
```

Lalu ubah dua baris di `/opt/efulfill/app/.env`:

```
NEXT_PUBLIC_APP_URL="https://gudang.namadomain.com"
SHOPEE_REDIRECT_URL="https://gudang.namadomain.com/api/v1/integrations/shopee/callback"
```

```bash
pm2 restart efulfill
```

**Jangan lupa:** daftarkan Redirect URL baru itu di Shopee Open Platform Console
(App Management → Redirect URL), karena harus sama persis.

---

## 5. Setelah aplikasi Live (go-live disetujui)

Ubah di `/opt/efulfill/app/.env`:

```
SHOPEE_PARTNER_ID="<Live Partner ID>"
SHOPEE_PARTNER_KEY="<Live Key>"
SHOPEE_SANDBOX="false"
```

```bash
pm2 restart efulfill
```

Lalu di aplikasi, buka menu **Hubungkan Shopee** → **Uji Koneksi** → otorisasi toko asli.
Setelah itu pesanan asli akan masuk otomatis (sinkronisasi tiap 60 detik + notifikasi webhook).

---

## 6. Keamanan (PENTING)

1. **Ganti kata sandi root VPS sekarang** karena sandi lama terkirim lewat chat:
   ```bash
   passwd root
   ```
2. Dianjurkan memakai **kunci SSH** dan mematikan login sandi:
   ```bash
   ssh-keygen -t ed25519            # dari komputer Anda
   ssh-copy-id root@103.178.174.224
   # lalu di server: /etc/ssh/sshd_config → PasswordAuthentication no
   systemctl restart ssh
   ```
3. Jangan pernah membagikan isi `/opt/efulfill/app/.env` (berisi sandi database,
   kunci JWT, kunci enkripsi kredensial Shopee).
4. Firewall sudah aktif: hanya port 22 (SSH), 80, dan 443 yang terbuka.

---

## 7. Troubleshooting

| Gejala | Yang diperiksa |
|---|---|
| Halaman tidak terbuka | `pm2 status` → `pm2 logs efulfill`; lalu `systemctl status nginx` |
| Aplikasi hidup tapi 502 | Aplikasi belum siap atau port 3000 mati: `pm2 restart efulfill` |
| Data tidak masuk otomatis | `pm2 logs efulfill \| grep -i "sinkronisasi otomatis"`; pastikan `.env` `AUTO_SYNC_ENABLED="true"` |
| Pembaruan langsung (realtime) tidak jalan | Pastikan `/api/v1/events/stream` tidak terputus: setelan `proxy_buffering off` di nginx harus ada |
| Gagal database | `systemctl status mysql`, cek `DATABASE_URL` di `.env` |
| Sertifikat SSL kedaluwarsa | `certbot renew --dry-run`, lalu `systemctl list-timers certbot.timer` |
| Sinkronisasi Shopee gagal | Periksa panel status di aplikasi (menampilkan pesan gagal apa adanya) atau `pm2 logs efulfill` |

---

## 8. Berkas deployment di repositori

| Berkas | Fungsi |
|---|---|
| `deploy/setup-vps.sh` | Instalasi dasar server (Node, MySQL, Nginx, Certbot, PM2, firewall) |
| `deploy/remote_deploy.py` | Deployment otomatis end-to-end dari komputer Anda |
| `deploy/nginx-efulfill.conf` | Konfigurasi Nginx (termasuk setelan khusus SSE/realtime) |
| `deploy/vps_survey.py` | Memeriksa kondisi server (OS, RAM, layanan terpasang) |
| `prisma/seed-production.ts` | Membuat akun pemilik + gudang tanpa data contoh |
| `docs/pengajuan-go-live-shopee.md` | Draf isian pengajuan Go Live |
