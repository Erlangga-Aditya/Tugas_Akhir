/**
 * Verifikasi READ-ONLY fitur Rekap Kerja Staf terhadap database nyata.
 *
 * Menjalankan usecase yang sama dengan endpoint
 * `GET /api/v1/reports/rekap-kerja-staf`, lalu memeriksa bentuk hasil yang
 * benar-benar dipakai komponen UI.
 *
 * Jalankan: npx tsx scripts/check-rekap-kerja-staf.ts
 */
import { prisma } from '../src/shared/infrastructure/prisma';
import { getRekapKerjaStaf } from '../src/modules/reports/application/rekap-kerja-staf.usecase';
import { mingguGajiBerdasarkanTanggal } from '../src/modules/reports/domain/minggu-gaji';

async function main() {
  const hariIni = new Date();
  const tahun = hariIni.getFullYear();
  const bulan = hariIni.getMonth() + 1;
  const { minggu } = mingguGajiBerdasarkanTanggal(hariIni);

  const tenant = await prisma.tenant.findFirst({ select: { id: true, name: true } });
  if (!tenant) {
    console.log('Tidak ada tenant di database.');
    return;
  }

  const hasil = await getRekapKerjaStaf(tenant.id, tahun, bulan, minggu);

  console.log(`Tenant  : ${tenant.name}`);
  console.log(`Periode : ${hasil.rentang.label} (minggu ke-${hasil.rentang.minggu})`);
  console.log(`Rentang : ${hasil.rentang.dari}  →  ${hasil.rentang.sampai}`);
  console.log(`Kolom   : ${hasil.kolomHari.length} hari (${hasil.namaHari.join(', ')})`);

  for (const jenis of [hasil.packing, hasil.serahKirim]) {
    const total = jenis.daftar.reduce((s, d) => s + d.total, 0);
    console.log(`- ${jenis.label}: ${total} pekerjaan, ${jenis.daftar.length} staf`);
    for (const staf of jenis.daftar.slice(0, 3)) {
      console.log(`    • ${staf.nama}: ${staf.total} paket, ${staf.perHari.length} hari aktif`);
    }
  }
  console.log(`Ringkasan per orang: ${hasil.ringkasan.length} baris`);

  // Bentuk minimum yang dipakai komponen — kalau ini lolos, UI tidak pecah.
  const wajib = ['rentang', 'namaHari', 'kolomHari', 'packing', 'serahKirim', 'ringkasan'] as const;
  for (const k of wajib) {
    if (!(k in hasil)) throw new Error(`Bentuk hasil tidak lengkap: ${k} tidak ada`);
  }
  if (!Array.isArray(hasil.kolomHari) || hasil.kolomHari.length === 0) {
    throw new Error('kolomHari kosong — tabel tidak akan punya kolom tanggal');
  }
  console.log('\nBENTUK HASIL: OK ✅');

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('GAGAL:', err);
  await prisma.$disconnect();
  process.exit(1);
});
