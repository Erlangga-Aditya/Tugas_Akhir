import type { NextConfig } from "next";

/**
 * Penting untuk aplikasi yang sering di-deploy ulang:
 *  - Halaman & API memakai `no-store` agar peramban (HP klien) tidak menahan
 *    HTML/JS versi lama. Gejalanya kalau tertahan: tombol tidak merespons dan
 *    kamera tidak muncul setelah deploy, karena chunk lama sudah hilang di server.
 *  - Aset statis `/_next/static` tetap di-cache lama (nama filanya berisi hash,
 *    jadi isinya selalu cocok dengan versi terbaru) → halaman tetap cepat.
 */
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Semua yang BUKAN aset statis Next.js: jangan disimpan peramban.
        source: "/:path((?!_next/static|_next/image|favicon.ico|sw.js).*)",
        headers: [
          { key: "Cache-Control", value: "no-store, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
