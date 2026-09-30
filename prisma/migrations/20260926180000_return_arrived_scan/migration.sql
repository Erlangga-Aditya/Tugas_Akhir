-- Memisahkan "retur sudah sampai di gudang" dari "retur sudah diterima".
--
-- MASALAH YANG DISELESAIKAN
-- --------------------------
-- Sebelumnya status `RECEIVED` dipakai untuk dua hal berbeda:
--   1. Shopee memberi tahu retur sedang dikirim / sudah diserahkan,
--   2. Operator menekan "Terima" di aplikasi.
-- Akibatnya tidak ada cara tahu kapan BARANGNYA benar-benar ada di gudang,
-- dan stok bisa bertambah pada tahap yang terlalu awal — sebelum paket sampai.
--
-- `ARRIVED` berarti paket retur benar-benar datang ke gudang (sudah dipindai
-- atau dikonfirmasi operator). Hanya dari status ini retur boleh naik ke
-- `RECEIVED` -> `INSPECTION` -> `RESTOCKED`, dan hanya di situlah stok bertambah.

-- Tambah status baru di tengah enum supaya nilai lama tidak berubah.
ALTER TABLE `returns` MODIFY COLUMN `status` ENUM(
  'REQUESTED',
  'IN_TRANSIT',
  'ARRIVED',
  'RECEIVED',
  'INSPECTION',
  'RESTOCKED',
  'DAMAGED',
  'REJECTED',
  'CLOSED'
) NOT NULL DEFAULT 'REQUESTED';

-- Catat kapan paket retur benar-benar tiba di gudang.
ALTER TABLE `returns` ADD COLUMN `arrived_at` DATETIME(3) NULL;

-- Jejak fisik per item: berapa unit yang benar-benar dipindai sampai di
-- gudang. Stok hanya bertambah dari angka ini, bukan dari status Shopee.
ALTER TABLE `return_items` ADD COLUMN `scanned_quantity` INT NOT NULL DEFAULT 0;
ALTER TABLE `return_items` ADD COLUMN `scanned_at` DATETIME(3) NULL;
