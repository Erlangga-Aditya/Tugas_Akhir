-- Jejak pembatalan pesanan: siapa yang membatalkan dan kapan.
--
-- `cancel_by` dari Shopee hanya bernilai buyer / seller / system / Ops. Tanpa
-- kolom ini, aplikasi tidak bisa membedakan "dibatalkan pembeli", "dibatalkan
-- penjual", dan "dibatalkan sistem karena terlambat" — padahal ketiganya
-- ditampilkan sebagai kartu berbeda di Seller Centre.
--
-- Semua kolom nullable dan tanpa default: penambahan tidak menyentuh data lama.
ALTER TABLE `orders`
  ADD COLUMN `cancel_by` VARCHAR(20) NULL,
  ADD COLUMN `cancel_reason` VARCHAR(80) NULL,
  ADD COLUMN `buyer_cancel_reason` VARCHAR(255) NULL,
  ADD COLUMN `cancel_requested_at` DATETIME(3) NULL,
  ADD COLUMN `cancelled_at` DATETIME(3) NULL;
