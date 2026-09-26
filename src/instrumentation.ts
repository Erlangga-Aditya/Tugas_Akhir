/**
 * Hook resmi Next.js (dijalankan sekali saat server hidup).
 * Dipakai untuk menyalakan sinkronisasi otomatis Shopee di sisi server, supaya
 * pesanan/resi baru masuk tanpa harus ada tab aplikasi yang terbuka.
 *
 * Dokumen Next.js: https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 */
export async function register() {
  // Hanya jalan di sisi server Node.js (bukan edge/browser).
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { startAutoSyncScheduler } = await import(
    '@/modules/integrations/application/autoSync.scheduler'
  );
  startAutoSyncScheduler();
}
