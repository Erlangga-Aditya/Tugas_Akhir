# Panduan Operator Gudang

Panduan ini untuk orang yang bekerja harian di gudang. Ditulis dengan bahasa
sehari-hari, tanpa istilah teknis.

Aturan besar yang berlaku di seluruh sistem:

> **Stok hanya berkurang satu kali, yaitu saat paket selesai dipacking.**
> Kalau ada yang aneh pada stok, jangan mengakali angka di layar — catat
> kejadiannya dan laporkan.

---

## 1. Satu halaman kerja

Semua pekerjaan harian ada di menu **Pesanan**. Di sana ada empat tab yang
urutannya mengikuti alur kerja:

| Tab | Artinya | Yang harus dilakukan |
|---|---|---|
| **Perlu Diproses** | Pesanan baru, belum punya resi | Ambil resi |
| **Siap Dikemas** | Resi sudah ada, barang belum dipilih | Pindai resi |
| **Siap Kirim** | Barang sudah dikemas | Serahkan ke kurir |
| **Sudah Dikirim** | Sudah diserahkan ke kurir | Tidak ada, hanya untuk melihat |

---

> **Tidak ada tombol "tarik data" di sistem ini.** Pesanan baru, nomor resi, dan
> status pengiriman masuk sendiri. Menu **Integrasi** hanya untuk menghubungkan
> toko dan memeriksa keadaannya.

---

## 2. Ambil resi

Resi harus ada lebih dulu sebelum paket bisa diproses.

### Satu pesanan

1. Buka tab **Perlu Diproses**.
2. Cari pesanannya.
3. Klik **Ambil Resi dari Shopee**.
4. Tunggu sebentar. Nomor resi muncul di kartu pesanan itu.
5. Kartu pesanan pindah ke tab **Siap Dikemas**.

### Banyak pesanan sekaligus

Kalau paginya pesanan menumpuk, jangan klik satu-satu.

1. Buka tab **Perlu Diproses**.
2. **Centang** kotak di kiri setiap pesanan yang mau diambil resinya. Boleh
   centang banyak sekaligus.
3. Sebuah panel muncul di atas. Klik **Ambil Resi Semua**.
4. Sistem memproses semuanya dalam satu kali jalan dan melaporkan hasilnya
   per pesanan: mana yang berhasil, mana yang gagal, dan alasannya.

**Kalau ada yang gagal, itu wajar.** Pesan gagalnya menjelaskan sebabnya,
misalnya kanal pengiriman memang belum siap. Perbaiki pesanan itu saja, jangan
mengulang semuanya.

> **Resi kadang terbit terlambat.** Pada beberapa kanal, Shopee menerima
> permintaan pengiriman lebih dulu dan baru menerbitkan nomornya puluhan detik
> kemudian. Kalau muncul pesan _"nomor resi belum tersedia"_, **tidak perlu
> melakukan apa pun** — sistem mengambil resinya sendiri saat pemeriksaan
> otomatis berjalan, biasanya dalam satu menit.

---

## 3. Cetak label

Label harus dicetak dari sistem. Jangan membuat label sendiri.

### Satu pesanan

Klik **Cetak Label Resi** pada kartu pesanan tersebut.

### Banyak pesanan sekaligus

1. Centang pesanan yang mau dicetak.
2. Klik **Cetak Label Semua**.
3. Satu berkas PDF berisi semua label langsung terunduh.
4. Cetak berkas itu seperti biasa.

Sesudah dicetak, sistem memeriksa barcode di setiap label dan memastikan
labelnya memang milik pesanan yang benar.

> **Kalau label ditolak dengan pesan "tidak cocok dengan pesanan ini"**,
> berarti barcode di dalam label itu milik pesanan lain. Jangan dicetak.
> Coba cetak ulang; kalau tetap sama, cetak dari Seller Centre Shopee.

**Catatan penting soal resi di label.** Sebagian kanal — misalnya
**Sameday Instant** — tidak mencetak nomor resi di labelnya. Yang tercetak
adalah nomor pesanan, kode pengambilan, dan logo kanal. Ini **normal** dan
bukan kerusakan. Jadi jangan bingung kalau nomor resi tidak terlihat di label
Sameday.

---

## 4. Pindai resi (pilih barang dan kemas)

Ini langkah yang **mengurangi stok**. Kerjakan dengan teliti.

1. Buka tab **Siap Dikemas**.
2. Ambil paketnya, lalu arahkan barcode label ke pemindai.
3. Kalau tidak ada pemindai, ketik nomornya secara manual di kolom
   **Scan Resi**, lalu tekan Enter.
4. Sistem memilih barangnya dan menyelesaikan pengemasan. Kartu pesanan
   pindah ke tab **Siap Kirim**.

Yang perlu diketahui:

- **Bisa memindai nomor resi atau nomor pesanan.** Pada label Sameday, yang
  tercetak adalah nomor pesanan, dan itu memang bisa dipindai.
- Kalau stok gudang tidak cukup, sistem menahan pesanan di tab
  **Perlu Diproses** dan memberi tahu berapa yang kurang. Tambahkan stok
  lewat menu Persediaan, lalu pesanannya berjalan sendiri.
- Memindai paket yang sudah selesai diproses tidak mengurangi stok dua kali.
  Sistem mengenalinya dan menolak dengan pesan yang jelas.

---

## 5. Serahkan ke kurir

1. Buka tab **Siap Kirim**.
2. Klik **Siap Kirim** pada kartu pesanannya.
3. Kartu pindah ke tab **Sudah Dikirim**.

Setelah ini sistem memberi tahu Shopee bahwa paket sudah diserahkan, dan status
di Shopee berubah menjadi _"menunggu paket diserahkan ke pihak jasa kirim"_
sampai kurir menjemputnya.

---

## 6. Mengatur staf dan hak akses

Hanya **owner** yang bisa membuka menu **Kelola Tim**.

### Menambah staf

1. Buka **Kelola Tim**.
2. Klik **Tambah Staff**.
3. Isi nama, email, dan kata sandi awal.
4. Centang **Hak akses** yang boleh dipakai orang itu.
5. Simpan. Berikan email dan kata sandinya kepada orang tersebut.

### Prinsip yang perlu dipegang

- **Beri akses seperlunya saja.** Kalau seseorang hanya mengemas paket, cukup
  beri akses halaman Pesanan. Jangan beri akses keuangan atau kredensial toko.
- **Akses berlaku seketika.** Begitu hak akses diubah atau dicabut, orang itu
  langsung terpengaruh pada klik berikutnya. Tidak perlu menunggu apa pun.
- **Menonaktifkan lebih baik daripada menghapus.** Akun yang dinonaktifkan tidak
  bisa masuk lagi, tetapi riwayat pekerjaannya tetap tersimpan.
- **Halaman yang tidak diizinkan tidak bisa dibuka** walaupun alamatnya diketik
  langsung. Ini dijaga sistem, bukan sekadar disembunyikan dari menu.

---

## 7. Kalau ada masalah

| Yang terlihat | Artinya | Yang dilakukan |
|---|---|---|
| Pesanan ada di **Perlu Diproses**, stok cukup, tapi tidak lanjut | Alokasi stok belum berjalan | Tambahkan stok lewat menu Persediaan; sistem otomatis mencoba lagi |
| Muncul _"Stok gudang belum cukup"_ | Barang kurang di gudang | Terima barang masuk lewat Persediaan, lalu tunggu |
| Muncul _"nomor resi belum tersedia"_ | Shopee belum menerbitkan resi | Diamkan saja; resinya terambil sendiri dalam sekitar satu menit |
| Muncul _"Paket belum siap dilabeli"_ | Kanal belum mengizinkan label dicetak | Tunggu beberapa menit, lalu coba lagi |
| Label ditolak _"tidak cocok dengan pesanan ini"_ | Barcode label bukan milik pesanan itu | Jangan dicetak; cetak ulang, kalau tetap gagal cetak dari Seller Centre |
| Nomor resi tidak terlihat di label | Normal untuk kanal seperti Sameday | Tidak ada yang perlu dilakukan |
| Staf tidak bisa membuka sebuah menu | Hak aksesnya memang belum diberikan | Minta owner memberikan akses |

Kalau masalahnya tidak ada di daftar ini, jangan menebak dan jangan mengubah
angka stok. Catat pesanan mana yang bermasalah dan pesan yang muncul, lalu
laporkan kepada yang mengelola sistem.
