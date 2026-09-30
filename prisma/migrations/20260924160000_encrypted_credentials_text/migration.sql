-- Perbaikan: kolom penyimpanan token Shopee terlalu pendek.
--
-- Migrasi awal (20260917193457_init) membuat kolom ini sebagai VARCHAR(191),
-- padahal skema menetapkan TEXT. Akibatnya, saat otorisasi Shopee berhasil dan
-- aplikasi mencoba menyimpan token terenkripsi (panjangnya beberapa ratus karakter),
-- penyimpanan gagal:
--     "The provided value for the column is too long for the column's type.
--      Column: encrypted_credentials"
-- Sehingga otorisasi selalu terlihat "gagal" walau di sisi Shopee berhasil.
--
-- Di database lama masalah ini tidak terlihat karena kolomnya sudah TEXT
-- (kemungkinan pernah disamakan lewat `prisma db push`). Migrasi ini menyamakan
-- semua database — termasuk yang dibuat baru dari nol — dengan skema.
--
-- Non-destruktif: hanya melebarkan tipe kolom, isi data tidak diubah.
ALTER TABLE `integration_connections`
  MODIFY COLUMN `encrypted_credentials` TEXT NULL;
