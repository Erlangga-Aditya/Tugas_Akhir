import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Test integrasi: memanggil proses Python (uv + PyMuPDF) untuk membaca barcode
 * dari PDF label Shopee asli. Berat dan lambat, jadi TIDAK ikut `npm run test`;
 * jalankan dengan `npm run test:integration` sebelum rilis.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.integration.test.ts'],
    exclude: ['node_modules', '.next'],
    // Pembacaan barcode butuh 20-30 detik per berkas; beri ruang.
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
