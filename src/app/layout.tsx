import type { Metadata } from 'next';
// Roboto dimuat TANPA daftar `weight`.
//
// Sebelumnya di sini tertulis weight: ['400','500','600','700']. Dengan daftar
// itu, Turbopack membangun kueri font yang berisi banyak entri dan gagal
// dengan "next/font/google queries have exactly one entry" - build produksi
// berhenti total. Kegagalannya sempat tersembunyi: selama `.next` masih ada,
// font diambil dari cache dan build lolos; begitu cache dibersihkan, build
// langsung mati.
//
// Tanpa `weight`, Next.js mengambil Roboto versi VARIABEL, yang mencakup
// seluruh ketebalan (100-900) dalam satu berkas. Hasil tampilannya sama, tapi
// kuerinya jadi satu entri sehingga masalahnya hilang.
import { Roboto } from 'next/font/google';
import './globals.css';
import { ServiceWorkerRegistrar } from '@/components/service-worker-registrar';

const roboto = Roboto({
  subsets: ['latin'],
  variable: '--font-roboto',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'E-Fulfill Hub — Operasional Pengiriman Shopee',
  description:
    'Platform operasional terintegrasi untuk manajemen pesanan, inventori, pengiriman, dan retur marketplace Shopee.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'E-Fulfill Hub',
    statusBarStyle: 'default',
  },
  icons: {
    icon: [
      { url: '/icons/favicon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className={roboto.variable}>
        <ServiceWorkerRegistrar />
        {children}
      </body>
    </html>
  );
}
