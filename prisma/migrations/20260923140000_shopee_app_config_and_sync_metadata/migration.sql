-- AlterTable
ALTER TABLE `sync_runs` ADD COLUMN `metadata_json` JSON NULL;

-- CreateTable
CREATE TABLE `marketplace_app_configs` (
    `id` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `mode` VARCHAR(191) NOT NULL DEFAULT 'PRODUCTION',
    `partner_id` VARCHAR(191) NOT NULL,
    `partner_key_encrypted` TEXT NOT NULL,
    `redirect_url` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `marketplace_app_configs_provider_key`(`provider`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

