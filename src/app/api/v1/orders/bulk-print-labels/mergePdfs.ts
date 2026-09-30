/**
 * Penggabung label PDF.
 *
 * Dipisah dari route supaya bisa diuji langsung tanpa menjalankan HTTP.
 *
 * Aturan yang dipegang: apa yang dilaporkan ke pemanggil harus PERSIS sama
 * dengan isi PDF yang dikembalikan. Kalau satu label gagal di-parse dan
 * diam-diam dilewati, pemanggil yang menghitung "berhasil" dari daftar
 * masters akan mendapat angka lebih besar dari kenyataan — dan operator akan
 * mencari label yang ternyata tidak pernah tercetak.
 */
import { logger } from '@/shared/observability/logger';

export type MergeOutcome = {
  /** Isi PDF gabungan, siap dikirim. */
  bytes: Uint8Array;
  /** Halaman yang benar-benar masuk ke PDF gabungan. */
  pages: number;
  /** Order yang tidak bisa dimasukkan, dengan alasannya. */
  dropped: { orderId: string; externalOrderId: string; reason: string }[];
};

/**
 * Gabungkan beberapa PDF label jadi satu tanpa mengubah isi halamannya.
 *
 * Label Shopee umumnya sudah punya struktur PDF/XObject sendiri, jadi yang
 * paling aman adalah merge per halaman: barcode tidak dikompres ulang dan
 * tetap bisa discan printer.
 */
export async function mergePdfs(
  entries: { orderId: string; externalOrderId: string; bytes: Uint8Array }[],
): Promise<MergeOutcome> {
  if (entries.length === 0) {
    throw new Error('Tidak ada label untuk digabungkan.');
  }
  const { PDFDocument } = await import('pdf-lib');

  if (entries.length === 1) {
    // Satu label: kirim apa adanya tanpa menyusun ulang (menyusun ulang satu
    // PDF tanpa alasan hanya berisiko merusak barcode-nya). Tapi isinya tetap
    // harus diperiksa dulu, supaya PDF rusak tidak terkirim sebagai 200 dan
    // jumlah halamannya tidak nebak-nebak.
    const only = entries[0]!;
    try {
      const src = await PDFDocument.load(only.bytes, { ignoreEncryption: true });
      const pages = src.getPageCount();
      if (pages === 0) {
        return {
          bytes: only.bytes,
          pages: 0,
          dropped: [
            { orderId: only.orderId, externalOrderId: only.externalOrderId, reason: 'Label tidak punya halaman.' },
          ],
        };
      }
      return { bytes: only.bytes, pages, dropped: [] };
    } catch (err) {
      const reason = (err as Error).message;
      logger.warn('Label PDF tidak bisa dibaca', { orderId: only.orderId, message: reason });
      return {
        bytes: only.bytes,
        pages: 0,
        dropped: [{ orderId: only.orderId, externalOrderId: only.externalOrderId, reason }],
      };
    }
  }

  const merged = await PDFDocument.create();
  const dropped: MergeOutcome['dropped'] = [];

  for (const entry of entries) {
    try {
      const src = await PDFDocument.load(entry.bytes, { ignoreEncryption: true });
      const indices = src.getPageIndices();
      if (indices.length === 0) {
        dropped.push({
          orderId: entry.orderId,
          externalOrderId: entry.externalOrderId,
          reason: 'Label tidak punya halaman.',
        });
        continue;
      }
      const pages = await merged.copyPages(src, indices);
      for (const page of pages) merged.addPage(page);
    } catch (err) {
      // Satu label rusak tidak boleh membatalkan yang sudah terkumpul — tapi
      // WAJIB dicatat, supaya tidak dilaporkan sebagai berhasil.
      const reason = (err as Error).message;
      logger.warn('Gagal menggabungkan satu label ke PDF gabungan', {
        orderId: entry.orderId,
        message: reason,
      });
      dropped.push({
        orderId: entry.orderId,
        externalOrderId: entry.externalOrderId,
        reason,
      });
    }
  }

  if (merged.getPageCount() === 0) {
    throw new Error(
      `Tidak ada halaman label yang bisa digabungkan (${dropped.length} label bermasalah).`,
    );
  }

  return { bytes: await merged.save(), pages: merged.getPageCount(), dropped };
}
