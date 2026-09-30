-- Rincian biaya & pembayaran pesanan (dari Shopee order detail / order_income).
-- Non-destruktif: hanya menambah kolom, data lama tetap utuh.
ALTER TABLE `orders`
  ADD COLUMN `buyer_note` TEXT NULL,
  ADD COLUMN `currency` VARCHAR(191) NULL,
  ADD COLUMN `total_amount` DOUBLE NULL,
  ADD COLUMN `item_subtotal` DOUBLE NULL,
  ADD COLUMN `seller_discount` DOUBLE NULL,
  ADD COLUMN `shopee_discount` DOUBLE NULL,
  ADD COLUMN `buyer_shipping_fee` DOUBLE NULL,
  ADD COLUMN `shipping_fee_discount` DOUBLE NULL,
  ADD COLUMN `platform_fee` DOUBLE NULL,
  ADD COLUMN `escrow_amount` DOUBLE NULL,
  ADD COLUMN `payment_method` VARCHAR(191) NULL,
  ADD COLUMN `is_cod` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN `paid_at` DATETIME(3) NULL,
  ADD COLUMN `package_number` VARCHAR(191) NULL,
  ADD COLUMN `income_json` JSON NULL;
