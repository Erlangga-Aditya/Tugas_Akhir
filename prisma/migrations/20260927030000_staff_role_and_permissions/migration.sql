-- Role STAFF + izin per-akun.
--
-- Menambah nilai baru ke enum MySQL tidak bisa dilakukan dengan
-- ALTER ... ADD VALUE (fitur itu hanya ada di PostgreSQL), jadi Kolomnya ditulis
-- ulang dengan daftar enum yang sudah lengkap. Baris yang sudah ada tidak
-- tersentuh: "OWNER" tetap valid dan tidak ada data yang hilang.
ALTER TABLE `tenant_memberships`
  MODIFY COLUMN `role` ENUM('OWNER', 'STAFF') NOT NULL;

ALTER TABLE `tenant_memberships`
  ADD COLUMN `permissions` JSON NULL;
