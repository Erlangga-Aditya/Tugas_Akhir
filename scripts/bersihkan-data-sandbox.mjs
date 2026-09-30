/* eslint-disable */
/**
 * Membersihkan DATA TRANSAKSI dari periode sandbox sebelum aplikasi dipakai
 * dengan akun penjual yang sebenarnya.
 *
 * KENAPA PERLU
 * ------------
 * Saat kredensial diganti dari sandbox ke produksi, baris toko yang sama
 * dipakai ulang - hanya `externalShopId`-nya yang berubah. Artinya seluruh
 * pesanan, produk, dan stok hasil pengujian sandbox TETAP ADA di database dan
 * akan bercampur dengan data toko asli: penjual melihat pesanan uji di
 * sebelah pesanan sungguhan, dan angka stok maupun laporan keuangan ikut
 * tercemar.
 *
 * CARA PAKAI
 * ----------
 *   node scripts/bersihkan-data-sandbox.mjs                  -> hanya MELAPORKAN
 *   node scripts/bersihkan-data-sandbox.mjs --jalan          -> menghapus
 *   node scripts/bersihkan-data-sandbox.mjs --jalan --backup -> menghapus setelah mencadangkan
 *
 * Bawaan tanpa argumen adalah MELAPORKAN saja. Penghapusan harus diminta
 * dengan sengaja, karena tidak bisa dibatalkan.
 *
 * YANG TIDAK DISENTUH
 * -------------------
 * Pengguna, peran & izin, keanggotaan tenant, tenant itu sendiri, toko,
 * gudang, aturan prioritas, dan konfigurasi aplikasi (kredensial mitra).
 * Semuanya dipertahankan supaya login dan pengaturan tidak perlu disiapkan
 * ulang setelah pembersihan.
 */

import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';

const prisma = new PrismaClient();
const JALAN = process.argv.includes('--jalan');
const BACKUP = process.argv.includes('--backup');

/**
 * Urutan penghapusan disusun dari cabang ke akar.
 *
 * Tabel yang merujuk tabel lain harus dihapus lebih dulu; kalau dibalik,
 * batasan kunci asing akan menolak. Urutan ini bukan pilihan gaya - salah
 * urut berarti perintahnya gagal.
 */
const URUTAN_HAPUS = [
  ['shipmentEvent', 'peristiwa pelacakan'],
  ['packingTask', 'tugas pengemasan'],
  ['pickingItem', 'rincian pengambilan barang'],
  ['pickingTask', 'tugas pengambilan barang'],
  ['shipment', 'pengiriman'],
  ['fulfillmentOrder', 'order pemenuhan'],
  ['orderStatusHistory', 'riwayat status pesanan'],
  ['returnItem', 'rincian retur'],
  ['return', 'retur'],
  ['stockReservation', 'reservasi stok'],
  ['inventoryMovement', 'mutasi stok'],
  ['stockLot', 'lot stok'],
  ['inventoryBalance', 'saldo stok'],
  ['externalProductMapping', 'pemetaan produk marketplace'],
  ['orderItem', 'rincian pesanan'],
  ['order', 'pesanan'],
  ['productVariant', 'varian produk'],
  ['product', 'produk'],
  ['syncRun', 'riwayat sinkronisasi'],
  ['webhookEvent', 'peristiwa webhook'],
  ['integrationConnection', 'koneksi marketplace'],
];

/** Yang dipertahankan, hanya untuk ditampilkan sebagai bukti tidak tersentuh. */
const DIPERTAHANKAN = [
  ['tenant', 'tenant'],
  ['user', 'pengguna'],
  ['tenantMembership', 'keanggotaan tenant'],
  ['shop', 'toko'],
  ['warehouse', 'gudang'],
  ['priorityRule', 'aturan prioritas'],
  ['marketplaceAppConfig', 'kredensial aplikasi mitra'],
];

async function hitung() {
  const hasil = [];
  for (const [model, label] of URUTAN_HAPUS) {
    hasil.push([model, label, await prisma[model].count()]);
  }
  return hasil;
}

async function main() {
  console.log('='.repeat(64));
  console.log(JALAN ? '  MODE: MENGHAPUS' : '  MODE: MELAPORKAN SAJA (tidak ada yang dihapus)');
  console.log('='.repeat(64));

  console.log('\n--- AKAN DIHAPUS (data transaksi / sandbox) ---');
  let totalAkanDihapus = 0;
  for (const [, label, jumlah] of await hitung()) {
    console.log(`  ${label.padEnd(32)} ${String(jumlah).padStart(7)}`);
    totalAkanDihapus += jumlah;
  }
  console.log(`  ${'TOTAL'.padEnd(32)} ${String(totalAkanDihapus).padStart(7)}`);

  console.log('\n--- TIDAK DISENTUH (login & pengaturan tetap utuh) ---');
  for (const [model, label] of DIPERTAHANKAN) {
    console.log(`  ${label.padEnd(32)} ${String(await prisma[model].count()).padStart(7)}`);
  }

  if (BACKUP) {
    console.log('\n--- MENCADANGKAN ---');
    const cadangan = {};
    for (const [model, label] of URUTAN_HAPUS) {
      cadangan[model] = await prisma[model].findMany();
      console.log(`  ${label.padEnd(32)} ${String(cadangan[model].length).padStart(7)} tersimpan`);
    }
    const nama = `cadangan-sandbox-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    writeFileSync(nama, JSON.stringify(cadangan, null, 2));
    console.log(`  Berkas: ${nama}`);
  }

  if (!JALAN) {
    console.log('\nTidak ada yang dihapus. Untuk benar-benar menghapus, jalankan ulang dengan --jalan');
    console.log('Disarankan menambahkan --backup supaya data lama masih bisa diperiksa.');
    return;
  }

  console.log('\n--- MENGHAPUS ---');
  for (const [model, label] of URUTAN_HAPUS) {
    const { count } = await prisma[model].deleteMany();
    console.log(`  ${label.padEnd(32)} ${String(count).padStart(7)} terhapus`);
  }

  console.log('\n--- SISA ---');
  for (const [model, label] of URUTAN_HAPUS) {
    console.log(`  ${label.padEnd(32)} ${String(await prisma[model].count()).padStart(7)}`);
  }
  console.log('\nSelesai. Hubungkan ulang toko dengan akun penjual yang sebenarnya.');
}

main()
  .catch((err) => {
    console.error('\nGAGAL:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
