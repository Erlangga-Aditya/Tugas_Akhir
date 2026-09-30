/**
 * Test pembaca barcode label memakai label RESMI Shopee yang disertakan di
 * repositori sebagai fixtur.
 *
 * Fixtur sengaja ikut ter-commit. Sebelumnya berkas ini disimpan di direktori
 * sementara yang diabaikan Git, sehingga test ini diam-diam DILEWATI di mesin
 * lain - termasuk saat build. Test yang melewati dirinya sendiri tanpa suara
 * lebih buruk daripada tidak ada test, karena membuat orang mengira barcode
 * sudah diperiksa padahal belum.
 *
 * Label ini berasal dari Shopee SANDBOX: alamat dan nomor teleponnya data
 * contoh, jadi tidak ada data pribadi yang ikut tersimpan.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLabelBarcodes, verifyShippingLabel } from './labelBarcode';

const LABEL_PDF = join(__dirname, '__fixtures__', 'label-shopee-sandbox.pdf');
const orderSn = '2609274DH4X168';

describe('Barcode label Shopee (PDF resmi dari Shopee sandbox)', () => {
  const pdf = readFileSync(LABEL_PDF);
  const workDir = mkdtempSync(join(tmpdir(), 'label-test-'));

  // Membaca barcode menjalankan proses Python (uv + PyMuPDF). Default vitest
  // 5 detik terlalu ketat: satu pembacaan butuh sekitar 3-4 detik sendiri, dan
  // lebih lama lagi saat suite berjalan paralel. Tanpa ini, test gagal karena
  // kehabisan waktu, bukan karena kodenya salah.
  const BATAS_MS = 30_000;

  it('fixtur label benar-benar berkas PDF', () => {
    // Penjaga sederhana: kalau fixtur rusak atau tergantikan, ketahuan di sini
    // dan bukan sebagai kegagalan pembaca barcode yang membingungkan.
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.byteLength).toBeGreaterThan(10_000);
  });

  it('menemukan barcode yang memuat nomor pesanan', async () => {
    const barcodes = await readLabelBarcodes(pdf, workDir);

    expect(barcodes.length).toBeGreaterThan(0);
    const texts = barcodes.map((b) => b.text);
    expect(
      texts.some((t) => t.includes(orderSn)),
      `barcode yang terbaca: ${JSON.stringify(texts)}`,
    ).toBe(true);
  }, BATAS_MS);

  it('format barcode yang terbaca adalah Code 128 atau QR', async () => {
    const barcodes = await readLabelBarcodes(pdf, workDir);
    const format = barcodes.find((b) => b.text.includes(orderSn))?.format;
    expect(['CODE_128', 'QR_CODE']).toContain(format);
  }, BATAS_MS);

  it('tidak pernah menyentuh decoder MaxiCode yang rekursi sampai stack overflow', async () => {
    // Label Shopee memuat logo yang ukurannya mirip barcode. Saat pembaca
    // menyapu semua format (MultiFormatReader), decoder MaxiCode ZXing
    // rekursi tanpa henti pada gambar seperti itu dan prosesnya mati.
    // Test ini menjaga supaya pembaca tetap memakai reader khusus.
    //
    // Yang diperiksa adalah PEMAKAIANNYA (`new zx.X`), bukan penyebutan di
    // komentar - penjelasan kenapa cara itu dihindari justru perlu tetap ada.
    const src = readFileSync(join(__dirname, 'labelBarcode.ts'), 'utf8');
    expect(src).not.toMatch(/new (zx\.)?MultiFormatReader/);
    expect(src).not.toMatch(/new (zx\.)?MaxiCodeReader/);
    expect(src).toMatch(/new Code128Reader\(\)/);
  });

  it('label dinyatakan sah untuk kanal yang tidak mencantumkan AWB', async () => {
    // Sameday Instant tidak mencetak AWB di label, jadi AWB dikosongkan.
    const res = await verifyShippingLabel(pdf, { orderSn, awb: null }, workDir);

    expect(res.problems).toEqual([]);
    expect(res.ok).toBe(true);
    expect(res.pages).toBe(1);
  }, BATAS_MS);

  it('menolak label yang bukan milik pesanan itu', async () => {
    // Nomor pesanan lain harus dianggap gagal, inilah yang mencegah label
    // salah-pesanan lolos tanpa terdeteksi.
    const res = await verifyShippingLabel(pdf, { orderSn: 'ORDER-LAIN-999', awb: null }, workDir);

    expect(res.ok).toBe(false);
    expect(res.problems.join(' ')).toMatch(/tidak memuat nomor pesanan/i);
  }, BATAS_MS);

  it('resi yang tidak tercetak di label TIDAK dianggap masalah', async () => {
    // Label Sameday Instant yang resmi dari Shopee memang tidak mencetak AWB.
    // Menjadikannya syarat membuat semua label kanal itu ditolak walaupun
    // aslinya benar - dan itu benar-benar terjadi di produksi. Yang dituntut
    // hanya penjelasan, bukan penolakan.
    const res = await verifyShippingLabel(pdf, { orderSn, awb: '3278361526652928297' }, workDir);

    expect(res.ok).toBe(true);
    expect(res.problems).toEqual([]);
    expect(res.notes.join(' ')).toMatch(/tidak tercetak di label ini/i);
  }, BATAS_MS);

  it('menolak berkas yang bukan PDF', async () => {
    const bukanPdf = Buffer.from('ini jelas bukan PDF sama sekali');
    await expect(readLabelBarcodes(bukanPdf, workDir)).rejects.toThrow(/bukan PDF/i);
  }, BATAS_MS);
});
