-- Penundaan pesanan oleh owner (aksi "Tunda" pada saran urutan kerja).
--
-- Disimpan sebagai kolom, bukan hanya audit, supaya saran urutan kerja bisa
-- mengecualikan pesanan yang sengaja ditunda dan bisa dipulihkan.
ALTER TABLE `orders`
  ADD COLUMN `deferred_until` DATETIME(3) NULL,
  ADD COLUMN `defer_reason` VARCHAR(191) NULL,
  ADD COLUMN `deferred_by_id` VARCHAR(30) NULL;
