-- Menyederhanakan role menjadi OWNER saja.
--
-- ALASAN
-- ------
-- Struktur role akan dideklarasikan ulang lengkap nanti (siapa boleh akses apa,
-- dan action apa yang boleh dilakukan), berdasarkan pemetaan kebutuhan nyata.
-- Sampai saat itu, role yang belum punya arti jelas tapi sudah jadi kode
-- produksi hanya menambah risiko: satu label akses yang "terlihat benar"
-- padahal aturannya belum pernah diuji.
--
-- Semua akun yang ada menjadi OWNER. Ini aman karena:
--   1. Endpoint sensitif sudah dikunci ke OWNER lebih dulu, jadi tidak ada
--      hak akses yang hilang saat role dihapus.
--   2. Satu toko = satu pemilik; tidak ada operator kedua yang tiba-tiba
--      kehilangan akses.
--
-- Urutan di bawah penting: data diubah DULU, baru enum dipangkas. Kalau enum
-- dipotong lebih dulu, baris yang masih bernilai MANAGER/FINANCE/STAFF tidak
-- bisa di-update lagi.

UPDATE `tenant_memberships` SET `role` = 'OWNER' WHERE `role` <> 'OWNER';

ALTER TABLE `tenant_memberships` MODIFY COLUMN `role` ENUM('OWNER') NOT NULL DEFAULT 'OWNER';
