import type { MetadataRoute } from 'next';

/**
 * Web App Manifest — supaya aplikasi bisa di-install ke layar utama HP
 * (Android: "Install app" / Chrome menu; iOS: Share → Add to Home Screen).
 *
 * start_url memakai /dashboard/pesanan karena itu halaman kerja operator
 * yang harus langsung terbuka setelah install.
 *
 * Ikon: 'any' + 'maskable' dua-duanya disediakan supaya Android tidak
 * memotong ikon jadi oval saat di-launcher.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'E-Fulfill Hub — Operasional Pengiriman Shopee',
    short_name: 'E-Fulfill Hub',
    description:
      'Kelola pesanan, stok gudang, dan pengiriman Shopee dalam satu halaman kerja.',
    // Operator butuh halaman ini terbuka langsung setelah install.
    start_url: '/dashboard/pesanan',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#EE4D2D',
    lang: 'id-ID',
    dir: 'ltr',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    // Shortcut: jalur paling sering dipakai operator, langsung dari home screen.
    shortcuts: [
      {
        name: 'Pesanan & Pengiriman',
        short_name: 'Pesanan',
        description: 'Kelola pesanan, scan resi, dan serah terima ke kurir.',
        url: '/dashboard/pesanan',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
      {
        name: 'Stok Gudang',
        short_name: 'Stok',
        description: 'Cek dan tambah stok gudang.',
        url: '/dashboard/inventori',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
    ],
  };
}
