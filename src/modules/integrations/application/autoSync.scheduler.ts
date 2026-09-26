import { prisma } from '@/shared/infrastructure/prisma';
import { logger } from '@/shared/observability/logger';
import { triggerOrderSync, triggerTrackingSync } from './sync.service';

/**
 * Sinkronisasi otomatis di sisi SERVER.
 *
 * Kenapa perlu: sebelumnya pembaruan hanya berjalan kalau ada tab browser terbuka
 * yang melakukan permintaan berkala, sehingga pesanan/resi baru tidak muncul kalau
 * operator belum menekan tombol sinkronisasi. Sekarang server sendiri yang menarik
 * data dari Shopee setiap menit, jadi data di layar selalu baru begitu dibuka.
 *
 * Catatan alur resmi Shopee:
 *  - Sebelum aplikasi Live, pembaruan didapat dengan cara menarik data (polling) —
 *    inilah yang dijalankan di sini.
 *  - Setelah aplikasi Live, Shopee juga mengirim notifikasi (push/webhook) dan
 *    itu ditangani di endpoint webhook; jadi keduanya saling melengkapi.
 *
 * Pengaturan lewat environment:
 *  - AUTO_SYNC_ENABLED=false            → matikan sinkronisasi otomatis
 *  - AUTO_SYNC_INTERVAL_MS=60000        → jarak antar-sinkronisasi (minimal 15000)
 */

const DEFAULT_INTERVAL_MS = 60_000;
const MIN_INTERVAL_MS = 15_000;

export interface AutoSyncTickResult {
  shops: number;
  imported: number;
  failed: number;
  finishedAt: Date;
}

/** Keadaan terakhir sinkronisasi otomatis — dipakai panel status di aplikasi. */
export const autoSyncState: {
  lastRunAt: Date | null;
  lastResult: AutoSyncTickResult | null;
  lastError: string | null;
} = {
  lastRunAt: null,
  lastResult: null,
  lastError: null,
};

let started = false;
let ticking = false;
let timer: ReturnType<typeof setInterval> | null = null;

export function isAutoSyncEnabled(): boolean {
  return process.env.AUTO_SYNC_ENABLED !== 'false';
}

export function getAutoSyncIntervalMs(): number {
  const raw = Number(process.env.AUTO_SYNC_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
  return Number.isFinite(raw) && raw >= MIN_INTERVAL_MS ? raw : DEFAULT_INTERVAL_MS;
}

/** Ambil satu toko Shopee yang tersambung untuk tiap tenant, beserta aktor audit-nya. */
async function listConnectedShopeeShops() {
  const connections = await prisma.integrationConnection.findMany({
    where: {
      provider: 'shopee',
      encryptedCredentials: { not: null },
      status: { in: ['ACTIVE', 'PENDING'] },
    },
    select: {
      shopId: true,
      shop: { select: { tenantId: true, name: true, status: true } },
    },
  });

  const usable = connections.filter((c) => c.shop.status === 'ACTIVE');
  const result: Array<{ tenantId: string; shopId: string; shopName: string; actorId: string }> = [];

  for (const conn of usable) {
    // Audit log butuh aktor nyata: pakai pemilik (OWNER) tenant, atau pengguna pertama.
    const membership =
      (await prisma.tenantMembership.findFirst({
        where: { tenantId: conn.shop.tenantId, role: 'OWNER' },
        orderBy: { createdAt: 'asc' },
        select: { userId: true },
      })) ??
      (await prisma.tenantMembership.findFirst({
        where: { tenantId: conn.shop.tenantId },
        orderBy: { createdAt: 'asc' },
        select: { userId: true },
      }));

    if (!membership) {
      logger.warn('Auto-sync dilewati: tenant belum punya pengguna untuk dicatat sebagai aktor audit', {
        tenantId: conn.shop.tenantId,
        shopId: conn.shopId,
      });
      continue;
    }

    result.push({
      tenantId: conn.shop.tenantId,
      shopId: conn.shopId,
      shopName: conn.shop.name,
      actorId: membership.userId,
    });
  }

  return result;
}

/**
 * Satu putaran sinkronisasi ringan (pesanan + nomor resi) untuk semua toko Shopee.
 * Aman dipanggil berulang: putaran yang masih berjalan tidak akan ditumpuk.
 */
export async function runAutoSyncTick(): Promise<AutoSyncTickResult> {
  if (ticking) {
    return autoSyncState.lastResult ?? { shops: 0, imported: 0, failed: 0, finishedAt: new Date() };
  }
  ticking = true;

  let shops = 0;
  let imported = 0;
  let failed = 0;
  let firstError: string | null = null;

  try {
    const targets = await listConnectedShopeeShops();
    for (const target of targets) {
      shops += 1;
      try {
        const res = (await triggerOrderSync(target.tenantId, target.shopId, target.actorId)) as {
          recordsWritten?: number;
        };
        imported += Number(res?.recordsWritten ?? 0);
      } catch (err) {
        failed += 1;
        const message = (err as Error).message;
        if (!firstError) firstError = message;
        logger.warn(`Auto-sync gagal untuk toko ${target.shopName}: ${message}`, { shopId: target.shopId });
      }

      // Status pengiriman harus ikut terambil otomatis. Sebelumnya hanya
      // pesanan yang di-sync, sehingga status "sedang OTW" dan "sudah
      // diterima" tidak pernah berubah kecuali operator menekan tombol manual
      // (yang sekarang sudah dihapus). Lacak Kiriman hanya menampilkan data
      // Shopee — jadi tanpa sync tracking, halaman itu statis.
      try {
        await triggerTrackingSync(target.tenantId, target.shopId, target.actorId);
      } catch (err) {
        // Kegagalan tracking tidak boleh menggagalkan sync pesanan: pesanan
        // tetap penting, status pengiriman akan dicoba lagi pada putar
        // berikutnya.
        const message = (err as Error).message;
        logger.warn(`Auto-sync tracking gagal untuk toko ${target.shopName}: ${message}`, {
          shopId: target.shopId,
        });
      }
    }
  } catch (err) {
    failed += 1;
    firstError = (err as Error).message;
    logger.error(`Auto-sync berhenti karena kesalahan tak terduga: ${firstError}`);
  } finally {
    ticking = false;
  }

  const result: AutoSyncTickResult = { shops, imported, failed, finishedAt: new Date() };
  autoSyncState.lastRunAt = result.finishedAt;
  autoSyncState.lastResult = result;
  autoSyncState.lastError = failed > 0 ? firstError : null;

  return result;
}

/**
 * Nyalakan penjadwal. Dipanggil sekali dari `src/instrumentation.ts`
 * (hook resmi Next.js yang dijalankan saat server hidup).
 */
export function startAutoSyncScheduler(): void {
  if (started) return;
  started = true;

  if (process.env.NEXT_PHASE === 'phase-production-build') {
    // Saat proses build: tidak perlu menjalankan penjadwal.
    return;
  }
  if (!isAutoSyncEnabled()) {
    logger.info('Sinkronisasi otomatis dimatikan (AUTO_SYNC_ENABLED=false).');
    return;
  }

  const intervalMs = getAutoSyncIntervalMs();

  // Putaran pertama sesaat setelah server siap, lalu berkala.
  const warmup = setTimeout(() => {
    void runAutoSyncTick();
  }, 4000);
  warmup.unref?.();

  timer = setInterval(() => {
    void runAutoSyncTick();
  }, intervalMs);
  timer.unref?.();

  logger.info(`Sinkronisasi otomatis Shopee aktif: setiap ${Math.round(intervalMs / 1000)} detik.`);
}

export function stopAutoSyncScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}
