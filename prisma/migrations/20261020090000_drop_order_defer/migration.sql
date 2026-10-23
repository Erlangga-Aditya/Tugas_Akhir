-- Fitur "saran urutan kerja + tunda" dibatalkan pemilik toko: panelnya
-- membingungkan dan menduplikasi pekerjaan yang sudah otomatis dilakukan
-- sinkronisasi Shopee. Kolomnya tidak pernah dipakai di produksi, jadi dibuang
-- agar skema tidak menyimpan sisa percobaan.
ALTER TABLE `orders`
  DROP COLUMN `deferred_until`,
  DROP COLUMN `defer_reason`,
  DROP COLUMN `deferred_by_id`;
