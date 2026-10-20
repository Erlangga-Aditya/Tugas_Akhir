import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    // Test integrasi dipisah: `*.integration.test.ts` menjalankan proses Python
    // (uv + PyMuPDF) yang butuh 20-30 detik per pembacaan. Saat seluruh suite
    // berjalan paralel, pembacaan itu melewati batas waktu dan membuat gate
    // merah padahal kodenya benar. Jalankan lewat `npm run test:integration`.
    exclude: ['node_modules', '.next', 'src/**/*.integration.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
