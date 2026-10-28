-- Status paket `CANCELLED` dipisahkan dari `FAILED`.
--
-- Kenapa: status PESANAN `CANCELLED` dulu dipetakan ke status PENGIRIMAN
-- `FAILED` (lihat `mapLogisticsStatus`), sehingga setiap pesanan batal muncul
-- di halaman Lacak Kiriman sebagai "Gagal kirim" dan di kartu pesanan sebagai
-- badge merah "Gagal kirim". Padahal tidak ada paket yang gagal: paketnya
-- memang tidak pernah diserahkan ke kurir.
--
-- Dua keadaan itu punya arti berbeda dan tidak boleh disatukan:
--   FAILED    = kurir gagal mengantar / paket hilang (paket SUDAH keluar gudang)
--   CANCELLED = pesanan dibatalkan sebelum paket dijemput kurir
--
-- Migrasi ini aditif: menambah satu nilai ENUM di urutan yang sama dengan
-- schema.prisma. Tidak ada kolom yang dihapus dan tidak ada tipe data berubah.
ALTER TABLE `shipments`
  MODIFY COLUMN `status` ENUM(
    'PENDING',
    'READY_TO_SHIP',
    'CANCELLED',
    'PICKED_UP',
    'IN_TRANSIT',
    'DELIVERED',
    'FAILED',
    'RETURNED'
  ) NOT NULL DEFAULT 'PENDING';

-- Perbaikan data lama (idempoten, aman dijalankan berulang).
--
-- Hanya menyentuh baris yang BUKTI belum pernah keluar gudang: tidak ada satu
-- pun peristiwa pelacakan PICKED_UP / IN_TRANSIT / DELIVERED. Baris yang punya
-- jejak perjalanan tidak diubah — kalau paketnya benar-benar gagal di jalan,
-- statusnya memang `FAILED` dan itu kenyataan yang harus tetap terlihat.
UPDATE `shipments` s
JOIN `orders` o ON o.`id` = s.`order_id`
SET s.`status` = 'CANCELLED',
    s.`shipped_at` = NULL,
    s.`delivered_at` = NULL
WHERE o.`status` = 'CANCELLED'
  AND s.`status` = 'FAILED'
  AND NOT EXISTS (
    SELECT 1 FROM `shipment_events` e
    WHERE e.`shipment_id` = s.`id`
      AND UPPER(e.`status`) IN ('PICKED_UP', 'IN_TRANSIT', 'DELIVERED')
  );
