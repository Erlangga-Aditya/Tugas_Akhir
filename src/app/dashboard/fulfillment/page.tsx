import { redirect } from 'next/navigation';

/** Halaman ini sudah digabung ke Pesanan & Pengiriman. */
export default function RedirectedPage() {
  redirect('/dashboard/pesanan');
}
