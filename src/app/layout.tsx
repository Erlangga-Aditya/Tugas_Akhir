import type { Metadata } from 'next';
import { Roboto } from 'next/font/google';
import './globals.css';
import { ServiceWorkerRegistrar } from '@/components/service-worker-registrar';

const roboto = Roboto({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
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
