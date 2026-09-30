import { redirect } from 'next/navigation';

/** Scan resi sekarang ada di halaman Pesanan & Pengiriman. */
export default function RedirectedPage() {
  redirect('/dashboard/pesanan');
}
