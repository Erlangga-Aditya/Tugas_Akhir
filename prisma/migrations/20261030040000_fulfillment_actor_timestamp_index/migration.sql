-- Indeks untuk laporan Rekap Kerja Staf: query rentang waktu per pelaku
-- pada kolom packed_at / handed_over_at (lihat rekap-kerja-staf.usecase.ts).
-- Tanpa indeks ini, query melakukan full scan pada fulfillment_orders.

CREATE INDEX `fulfillment_orders_packed_at_idx` ON `fulfillment_orders`(`packed_at`);

CREATE INDEX `fulfillment_orders_handed_over_at_idx` ON `fulfillment_orders`(`handed_over_at`);
