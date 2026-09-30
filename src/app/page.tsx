import { redirect } from 'next/navigation';

/**
 * Akar domain tidak menampilkan landing page.
 *
 * Aplikasi ini dipakai seller individual yang mendapat akses lewat Go-Live
 * App Shopee, bukan lewat pendaftaran publik. Menampilkan halaman produk di
 * `/` hanya menambah satu klik yang tidak perlu, dan tombol "Daftar Gratis"
 * selalu tidak boleh dipakai — akun hanya sah bila dibuat di Seller Centre.
 *
 * Jadi akar domain langsung membuka halaman masuk. Pengguna yang sudah punya
 * sesi tetap diarahkan ke dashboard oleh proxy, sehingga tidak ada pengulangan
 * halaman login untuk yang sudah masuk.
 */
export default function HomePage() {
  redirect('/login');
}
