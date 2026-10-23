/**
 * Driver verifikasi PDF: membangun PDF dari data tiruan melalui jalur produksi
 * asli (domain → pdf-lib), lalu memverifikasi geometri & isi dengan pymupdf.
 *
 * Jalankan: uv run --with pymupdf npx tsx scripts/verify-pdf.driver.ts
 */
import { writeFileSync } from 'node:fs';
import { buatPdfProduksi, type DataProduksi } from '../src/modules/fulfillment/application/production-pdf';

function dataTiruan(): DataProduksi {
  const base = new Date('2026-10-23T05:00:00+07:00');
  const jam = (h: number) => new Date(base.getTime() + h * 3600_000).toISOString();
  return {
    grup: [
      { nama: 'Bukhori Set', jilid: null, totalUnit: 13, pesanan: [] },
      { nama: 'Ibnu Majah Set', jilid: null, totalUnit: 2, pesanan: [] },
      { nama: 'Muslim Set', jilid: null, totalUnit: 1, pesanan: [] },
      { nama: 'Nasai Set', jilid: null, totalUnit: 4, pesanan: [] },
      { nama: 'Tirmidzi Set', jilid: null, totalUnit: 1, pesanan: [] },
      { nama: 'Bukhori Jilid 1', jilid: 1, totalUnit: 1, pesanan: [] },
      { nama: 'Muslim Jilid 3', jilid: 3, totalUnit: 2, pesanan: [] },
    ],
    totalPesanan: 28,
    totalUnit: 38,
    kodeBatch: 'PROD-20261023-1',
    dicetakPada: new Date('2026-10-23T00:33:13+07:00'),
    mendesak: [
      { orderId: 'o1', externalOrderId: 'x1', nama: 'Bukhori Set', qty: 5, batasKirim: jam(-33), sisaTeks: 'Lewat 1 hari 9 jam', nada: 'lewat', jam: -33 },
      { orderId: 'o2', externalOrderId: 'x2', nama: 'Muslim Jilid 1', qty: 4, batasKirim: jam(-10), sisaTeks: 'Lewat 10 jam', nada: 'lewat', jam: -10 },
      { orderId: 'o3', externalOrderId: 'x3', nama: 'Muslim Jilid 3', qty: 2, batasKirim: jam(-7), sisaTeks: 'Lewat 7 jam', nada: 'kritis', jam: -7 },
      { orderId: 'o4', externalOrderId: 'x4', nama: 'Bukhori Set', qty: 2, batasKirim: jam(-2), sisaTeks: 'Lewat 2 jam', nada: 'kritis', jam: -2 },
      { orderId: 'o5', externalOrderId: 'x5', nama: 'Bukhori Jilid 4', qty: 1, batasKirim: jam(4), sisaTeks: 'Sisa 4 jam', nada: 'waspada', jam: 4 },
    ],
  };
}

async function main() {
  const pdf = await buatPdfProduksi(dataTiruan());
  writeFileSync('verify-pdf-output.pdf', pdf);
  const kosong = await buatPdfProduksi({ ...dataTiruan(), mendesak: [], grup: [] });
  writeFileSync('verify-pdf-kosong.pdf', kosong);
  console.log(`PDF normal: ${pdf.length} byte | PDF kosong: ${kosong.length} byte`);
}

main().catch((e) => {
  console.error('ERR', e);
  process.exit(1);
});
