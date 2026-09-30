/**
 * Test penggabung label PDF.
 *
 * Yang diuji adalah satu janji: jumlah label yang dilaporkan berhasil harus
 * sama dengan yang benar-benar masuk ke PDF. Kalau tidak, operator mencari
 * label yang tidak pernah tercetak — dan itu lebih buruk daripada gagal
 * dengan pesan jelas.
 */
import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { mergePdfs } from './mergePdfs';

async function makePdf(pages: number, label: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) {
    const page = doc.addPage([200, 200]);
    page.drawText(label);
  }
  return doc.save();
}

const entry = (orderId: string, bytes: Uint8Array) => ({
  orderId,
  externalOrderId: `EXT-${orderId}`,
  bytes,
});

describe('mergePdfs', () => {
  it('menolak daftar kosong dengan pesan yang jelas', async () => {
    await expect(mergePdfs([])).rejects.toThrow(/tidak ada label/i);
  });

  it('satu label dikirim apa adanya, tanpa menyusun ulang', async () => {
    const bytes = await makePdf(1, 'AWB-111');
    const out = await mergePdfs([entry('a', bytes)]);
    expect(out.bytes).toBe(bytes);
    expect(out.pages).toBe(1);
    expect(out.dropped).toHaveLength(0);
  });

  it('satu label multi-halaman: halamannya dihitung dari PDF, bukan diasumsikan 1', async () => {
    // Label Shopee untuk pesanan yang dipecah beberapa paket bisa lebih dari
    // satu halaman. Mengasumsikan 1 membuat angka di header berbohong.
    const bytes = await makePdf(3, 'AWB-MULTI');
    const out = await mergePdfs([entry('a', bytes)]);
    expect(out.pages).toBe(3);
    expect(out.dropped).toHaveLength(0);
  });

  it('satu label rusak dilaporkan dropped dengan pages 0, bukan dikirim apa adanya', async () => {
    const rusak = new Uint8Array(Buffer.from('bukan PDF sama sekali'));
    const out = await mergePdfs([entry('a', rusak)]);
    // Caller memakai pages === 0 untuk menolak, jadi pages harus jujur 0.
    expect(out.pages).toBe(0);
    expect(out.dropped).toHaveLength(1);
    expect(out.dropped[0]!.orderId).toBe('a');
  });

  it('menggabungkan semua halaman dari semua label', async () => {
    const out = await mergePdfs([
      entry('a', await makePdf(1, 'AWB-1')),
      entry('b', await makePdf(1, 'AWB-2')),
      entry('c', await makePdf(2, 'AWB-3')),
    ]);
    expect(out.pages).toBe(4);
    expect(out.dropped).toHaveLength(0);
    // Hasilnya harus tetap PDF yang bisa dibuka.
    expect(Buffer.from(out.bytes.subarray(0, 5)).toString('ascii')).toBe('%PDF-');
  });

  it('label rusak dilaporkan sebagai dropped, bukan dihitung berhasil', async () => {
    const rusak = new Uint8Array(Buffer.from('ini jelas bukan PDF sama sekali'));
    const out = await mergePdfs([
      entry('baik', await makePdf(1, 'AWB-1')),
      entry('rusak', rusak),
    ]);
    // Yang benar masuk: 1 halaman. Yang rusak harus tercatat.
    expect(out.pages).toBe(1);
    expect(out.dropped).toHaveLength(1);
    expect(out.dropped[0]!.orderId).toBe('rusak');
    expect(out.dropped[0]!.reason).toBeTruthy();
  });

  it('semua label rusak -> error, bukan PDF kosong', async () => {
    const rusak = new Uint8Array(Buffer.from('bukan PDF'));
    await expect(mergePdfs([entry('a', rusak), entry('b', rusak)])).rejects.toThrow(
      /tidak ada halaman label/i,
    );
  });

  it('PDF rusak di tengah daftar tidak menggagalkan yang lain', async () => {
    const kosong = new Uint8Array(Buffer.from('%PDF-1.4\n%%EOF\n'));
    const out = await mergePdfs([entry('ok', await makePdf(1, 'AWB-1')), entry('kosong', kosong)]);
    expect(out.pages).toBe(1);
    expect(out.dropped.map((d) => d.orderId)).toEqual(['kosong']);
  });

  it('halaman hasil merge sama dengan jumlah halaman yang dijanjikan', async () => {
    const entries = [];
    for (let i = 0; i < 5; i += 1) {
      entries.push(entry(`o${i}`, await makePdf(i + 1, `AWB-${i}`)));
    }
    const out = await mergePdfs(entries);
    expect(out.pages).toBe(1 + 2 + 3 + 4 + 5);
    const reopened = await PDFDocument.load(out.bytes);
    expect(reopened.getPageCount()).toBe(15);
  });
});
