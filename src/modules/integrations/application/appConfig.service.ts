import { prisma } from '@/shared/infrastructure/prisma';
import { encryptSecret, decryptSecret } from '../infrastructure/crypto.service';
import { ValidationError } from '@/shared/errors/AppError';
import { logger } from '@/shared/observability/logger';

/**
 * Konfigurasi aplikasi partner Shopee.
 *
 * Sumber kebenaran: baris `MarketplaceAppConfig` yang DIISI DARI UI (tanpa edit .env).
 * Kalau baris itu belum ada, sistem memakai kredensial .env — supaya instalasi lama
 * tetap jalan tanpa perubahan.
 */

export type ShopeeMode = 'PRODUCTION' | 'SANDBOX';

export interface ShopeeAppConfig {
  partnerId: string;
  partnerKey: string;
  mode: ShopeeMode;
  sandbox: boolean;
  apiHost: string;
  redirectUrl: string | null;
  source: 'database' | 'env';
}

const PRODUCTION_HOST = () => process.env.SHOPEE_API_HOST || 'https://partner.shopeemobile.com';
const SANDBOX_HOST = () =>
  process.env.SHOPEE_SANDBOX_HOST || 'https://openplatform.sandbox.test-stable.shopee.sg';

/** Cache pendek supaya signing (sync path) tidak query DB tiap request. */
let cache: { value: ShopeeAppConfig; at: number } | null = null;
const CACHE_TTL_MS = 10_000;

export function invalidateShopeeAppConfigCache(): void {
  cache = null;
}

function hostFor(mode: ShopeeMode): string {
  return mode === 'SANDBOX' ? SANDBOX_HOST() : PRODUCTION_HOST();
}

function fromEnv(): ShopeeAppConfig {
  const sandbox = process.env.SHOPEE_SANDBOX === 'true';
  const mode: ShopeeMode = sandbox ? 'SANDBOX' : 'PRODUCTION';
  return {
    partnerId: process.env.SHOPEE_PARTNER_ID ?? '',
    partnerKey: process.env.SHOPEE_PARTNER_KEY ?? '',
    mode,
    sandbox,
    apiHost: hostFor(mode),
    redirectUrl: process.env.SHOPEE_REDIRECT_URL ?? null,
    source: 'env',
  };
}

/** Ambil konfigurasi aktif (DB → fallback .env). Tidak pernah melempar error. */
export async function getShopeeAppConfig(): Promise<ShopeeAppConfig> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  let value: ShopeeAppConfig | null = null;
  try {
    const row = await prisma.marketplaceAppConfig.findUnique({ where: { provider: 'shopee' } });
    if (row) {
      const mode: ShopeeMode = row.mode === 'SANDBOX' ? 'SANDBOX' : 'PRODUCTION';
      value = {
        partnerId: row.partnerId,
        partnerKey: decryptSecret(row.partnerKeyEncrypted),
        mode,
        sandbox: mode === 'SANDBOX',
        apiHost: hostFor(mode),
        redirectUrl: row.redirectUrl,
        source: 'database',
      };
    }
  } catch (err) {
    // DB belum dimigrasi / kredensial gagal didekripsi → jangan matikan seluruh aplikasi.
    logger.warn('Gagal membaca konfigurasi partner dari database, memakai .env', {
      error: (err as Error).message,
    });
  }

  value = value ?? fromEnv();
  cache = { value, at: Date.now() };
  return value;
}

/** Versi untuk UI: partner key tidak pernah dikirim ke browser. */
export async function getShopeeAppConfigPublic() {
  const cfg = await getShopeeAppConfig();
  return {
    partnerId: cfg.partnerId || null,
    hasPartnerKey: Boolean(cfg.partnerKey),
    mode: cfg.mode,
    sandbox: cfg.sandbox,
    apiHost: cfg.apiHost,
    redirectUrl: cfg.redirectUrl,
    source: cfg.source,
    configured: Boolean(cfg.partnerId && cfg.partnerKey),
  };
}

export async function saveShopeeAppConfig(input: {
  partnerId: string;
  partnerKey?: string;
  mode: ShopeeMode;
  redirectUrl?: string | null;
}): Promise<void> {
  const partnerId = input.partnerId.trim();
  if (!/^\d+$/.test(partnerId)) {
    throw new ValidationError('Partner ID harus berupa angka (lihat App Management di Shopee Console).');
  }
  if (input.mode !== 'PRODUCTION' && input.mode !== 'SANDBOX') {
    throw new ValidationError('Mode harus PRODUCTION atau SANDBOX.');
  }

  const existing = await prisma.marketplaceAppConfig.findUnique({ where: { provider: 'shopee' } });
  const partnerKeyEncrypted = input.partnerKey?.trim()
    ? encryptSecret(input.partnerKey.trim())
    : existing?.partnerKeyEncrypted;

  if (!partnerKeyEncrypted) {
    throw new ValidationError('Partner Key wajib diisi saat pertama kali menyimpan.');
  }

  const redirectUrl = input.redirectUrl?.trim() || null;

  await prisma.marketplaceAppConfig.upsert({
    where: { provider: 'shopee' },
    create: { provider: 'shopee', partnerId, partnerKeyEncrypted, mode: input.mode, redirectUrl },
    update: { partnerId, partnerKeyEncrypted, mode: input.mode, redirectUrl },
  });

  invalidateShopeeAppConfigCache();
  logger.info('Konfigurasi partner Shopee disimpan', { partnerId, mode: input.mode });
}
