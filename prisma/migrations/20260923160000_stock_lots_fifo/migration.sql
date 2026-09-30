-- AlterTable
ALTER TABLE `inventory_movements` ADD COLUMN `stock_lot_id` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `stock_lots` (
    `id` VARCHAR(191) NOT NULL,
    `warehouse_id` VARCHAR(191) NOT NULL,
    `variant_id` VARCHAR(191) NOT NULL,
    `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `quantity` INTEGER NOT NULL,
    `remaining` INTEGER NOT NULL,
    `source` VARCHAR(191) NOT NULL DEFAULT 'RECEIVE',
    `reference_id` VARCHAR(191) NULL,
    `notes` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `stock_lots_warehouse_id_variant_id_received_at_idx`(`warehouse_id`, `variant_id`, `received_at`),
    INDEX `stock_lots_remaining_idx`(`remaining`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `stock_lots` ADD CONSTRAINT `stock_lots_warehouse_id_fkey` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_lots` ADD CONSTRAINT `stock_lots_variant_id_fkey` FOREIGN KEY (`variant_id`) REFERENCES `product_variants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

