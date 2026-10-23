-- Jejak aktor per tahap pekerjaan gudang.
--
-- Pembayaran packer dan kurir internal dihitung per paket, jadi "siapa
-- mempacking paket ini" dan "siapa menyerahkannya ke kurir" harus tersimpan
-- sebagai data, bukan hanya terserak di audit log.
--
-- Semua kolom nullable tanpa default: penambahan tidak menyentuh baris lama.
ALTER TABLE `fulfillment_orders`
  ADD COLUMN `picked_by_id` VARCHAR(30) NULL,
  ADD COLUMN `picked_at` DATETIME(3) NULL,
  ADD COLUMN `packed_by_id` VARCHAR(30) NULL,
  ADD COLUMN `packed_at` DATETIME(3) NULL,
  ADD COLUMN `handed_over_by_id` VARCHAR(30) NULL,
  ADD COLUMN `handed_over_at` DATETIME(3) NULL;

CREATE INDEX `fulfillment_orders_packed_by_id_idx` ON `fulfillment_orders`(`packed_by_id`);
CREATE INDEX `fulfillment_orders_handed_over_by_id_idx` ON `fulfillment_orders`(`handed_over_by_id`);
