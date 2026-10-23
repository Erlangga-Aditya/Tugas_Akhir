/*
  Warnings:

  - You are about to alter the column `buyer_cancel_reason` on the `orders` table. The data in that column could be lost. The data in that column will be cast from `VarChar(255)` to `VarChar(191)`.

*/
-- DropIndex
DROP INDEX `fulfillment_orders_handed_over_by_id_idx` ON `fulfillment_orders`;

-- DropIndex
DROP INDEX `fulfillment_orders_packed_by_id_idx` ON `fulfillment_orders`;

-- AlterTable
ALTER TABLE `fulfillment_orders` MODIFY `picked_by_id` VARCHAR(191) NULL,
    MODIFY `packed_by_id` VARCHAR(191) NULL,
    MODIFY `handed_over_by_id` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `orders` MODIFY `external_status` VARCHAR(191) NULL,
    MODIFY `cancel_by` VARCHAR(191) NULL,
    MODIFY `cancel_reason` VARCHAR(191) NULL,
    MODIFY `buyer_cancel_reason` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `production_batches` (
    `id` VARCHAR(191) NOT NULL,
    `tenant_id` VARCHAR(191) NOT NULL,
    `kode_batch` VARCHAR(191) NOT NULL,
    `printed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `printed_by` VARCHAR(191) NULL,
    `total_orders` INTEGER NOT NULL,
    `total_units` INTEGER NOT NULL,
    `order_ids` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `production_batches_tenant_id_printed_at_idx`(`tenant_id`, `printed_at`),
    UNIQUE INDEX `production_batches_tenant_id_kode_batch_key`(`tenant_id`, `kode_batch`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
