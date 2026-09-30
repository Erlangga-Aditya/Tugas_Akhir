/**
 * Registry izin aplikasi — SATU sumber kebenaran untuk backend dan UI.
 *
 * Kenapa registry dan bukan daftar acak di tiap route:
 *  - Owner mengubah satu daftar di halaman Tim, dan semua yang berubah
 *    bersamaan: menu yang tampil, halaman yang bisa dibuka, dan aksi yang
 *    diterima API. Kalau dipisah, pasti ada saat UI sudah sembunyi tapi
 *    endpoint-nya masih terbuka (atau sebaliknya).
 *  - `assertPermission` gagal dengan nama aksi dalam bahasa awam, jadi operator
 *    tahu apa yang kurang tanpa perlu dijelaskan.
 *
 * Izin dipakai dua arah:
 *  - `page`  → halaman dashboard yang boleh dibuka (proxy + sidebar)
 *  - `action`→ operasi yang boleh dijalankan (setiap route API)
 *
 * OWNER selalu lolos semua pemeriksaan. Tidak ada pengecualian di kode: satu
 * sumber aturan ini yang memutuskan.
 */

export const PERMISSIONS = {
  // ── Halaman ───────────────────────────────────────────────────────────────
  /** Ringkasan operasional di /dashboard */
  'page.dashboard': { label: 'Ringkasan', group: 'Halaman' },
  /** Pesanan & Pengiriman: antrean, ambil resi, pilih, kirim */
  'page.orders': { label: 'Pesanan & Pengiriman', group: 'Halaman' },
  /** Stok Gudang */
  'page.inventory': { label: 'Stok Gudang', group: 'Halaman' },
  /** Produk */
  'page.products': { label: 'Produk', group: 'Halaman' },
  /** Lacak Kiriman */
  'page.shipping': { label: 'Lacak Kiriman', group: 'Halaman' },
  /** Pengembalian */
  'page.returns': { label: 'Pengembalian', group: 'Halaman' },
  /** Laporan operasional */
  'page.reports': { label: 'Laporan', group: 'Halaman' },
  /** Laporan Keuangan */
  'page.finance': { label: 'Laporan Keuangan', group: 'Halaman' },
  /** Hubungkan Shopee */
  'page.integrations': { label: 'Hubungkan Shopee', group: 'Halaman' },
  /** Pengaturan umum */
  'page.settings': { label: 'Pengaturan', group: 'Halaman' },
  /** Kelola Tim — hanya owner yang boleh mengganti izin staff */
  'page.team': { label: 'Kelola Tim', group: 'Halaman' },

  // ── Aksi: pesanan & pengiriman ───────────────────────────────────────────
  /** Mengubah status pesanan jadi dibatalkan */
  'order.cancel': { label: 'Membatalkan pesanan', group: 'Aksi' },
  /** Mengatur pengiriman: ambil resi dari Shopee */
  'order.prepare_shipment': { label: 'Mengatur pengiriman & mengambil resi', group: 'Aksi' },
  /** Mengambil barang dari rak */
  'order.pick': { label: 'Mengambil barang (picking)', group: 'Aksi' },
  /** Mengemas barang & menempel label */
  'order.pack': { label: 'Mengemas & mencetak label', group: 'Aksi' },
  /** Menyerahkan paket ke kurir (ship ke Shopee) */
  'order.handover': { label: 'Menyerahkan paket ke kurir', group: 'Aksi' },
  /** Membatalkan pesanan lewat fulfillment */
  'order.requeue': { label: 'Mengembalikan pesanan ke antrean', group: 'Aksi' },

  // ── Aksi: stok & produk ──────────────────────────────────────────────────
  /** Menyesuaikan angka stok hasil hitung fisik */
  'inventory.adjust': { label: 'Menyesuaikan stok', group: 'Aksi' },
  /** Membuat / mengubah produk, varian, dan harga */
  'product.manage': { label: 'Mengelola produk', group: 'Aksi' },
  /** Menerima barang masuk (barang datang) */
  'inventory.receive': { label: 'Menerima barang masuk', group: 'Aksi' },

  // ── Aksi: sistem ─────────────────────────────────────────────────────────
  /** Menjalankan sinkronisasi Shopee secara manual */
  'shopee.sync': { label: 'Sinkronisasi Shopee', group: 'Aksi' },
  /** Mengubah kredensial/partner app Shopee */
  'shopee.manage': { label: 'Mengatur koneksi Shopee', group: 'Aksi' },
  /** Melihat laporan keuangan */
  'finance.view': { label: 'Melihat laporan keuangan', group: 'Aksi' },
  /** Membuat staff, mengubah izinnya, menonaktifkan akun */
  'team.manage': { label: 'Mengelola anggota tim', group: 'Aksi' },
  /** Mengubah pengaturan aplikasi */
  'settings.manage': { label: 'Mengubah pengaturan aplikasi', group: 'Aksi' },
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as Permission[];

export const PAGE_PERMISSIONS = PERMISSION_KEYS.filter(
  (k) => k.startsWith('page.'),
) as readonly Permission[];

export const ACTION_PERMISSIONS = PERMISSION_KEYS.filter(
  (k) => !k.startsWith('page.'),
) as readonly Permission[];

/** Izin yang diberikan ke staff baru bila owner tidak memilih apa pun. */
export const DEFAULT_STAFF_PERMISSIONS: readonly Permission[] = [
  'page.dashboard',
  'page.orders',
  'page.inventory',
  'page.products',
  'page.shipping',
  'order.prepare_shipment',
  'order.pick',
  'order.pack',
  'order.handover',
  'inventory.receive',
  'shopee.sync',
];

/** Izin_team.manage selalu ada hanya di owner. */
export const OWNER_ONLY_PERMISSIONS: readonly Permission[] = [
  'page.team',
  'team.manage',
  'page.finance',
  'finance.view',
  'settings.manage',
];

/**
 * Owner: semua izin, selalu. Staff: tepat yang owner pilih.
 *
 * Fungsi ini tidak pernah menyentuh database — pemanggil yang menambahkan
 * cache, supaya bisa dipakai dari proxy (edge) maupun route handler (node).
 */
export function can(role: string, permissions: readonly string[] | null | undefined, permission: Permission): boolean {
  // OWNER bebas. `else if`, bukan `if` terpisah: tanpa itu, role yang tidak
  // dikenal (mis. "ADMIN" dari token lama atau data rusak) TETAP lolos selama
  // ia punya daftar izin — itu fail-OPEN pada penjaga keamanan.
  if (role === 'OWNER') return true;
  if (role !== 'STAFF') return false;
  return Array.isArray(permissions) && permissions.includes(permission);
}
