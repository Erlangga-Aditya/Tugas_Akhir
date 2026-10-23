import { prisma } from '@/shared/infrastructure/prisma';
import { hitungSisaWaktu } from '../domain/countdown';
import { buatKodeBatch } from '../domain/production-batch';
import {
  amanUntukPdf,
  formatDeadline,
  kelompokkanProduksi,
  namaPendek,
  type BarisProduksi,
  type DaftarProduksi,
} from '../domain/production-list';
import { classifyWorkQueue } from '../domain/work-queue';

export interface PesananMendesak {
  orderId: string;
  externalOrderId: string;
  /** Nama pendek produk (sama seperti di lembar produksi). */
  nama: string;
  qty: number;
  batasKirim: string;
  /** Mis. "Sisa 6 jam" / "Lewat 3 jam". */
  sisaTeks: string;
  nada: 'lewat' | 'kritis' | 'waspada' | 'aman';
  jam: number;
}

export interface DataProduksi extends DaftarProduksi {
  kodeBatch: string;
  dicetakPada: Date;
  /** 5 pesanan dengan batas kirim paling dekat (paling cepat dibatalkan Shopee). */
  mendesak: PesananMendesak[];
}

/**
 * Mengambil pesanan yang barangnya belum ada (pekerjaan gudang WAITING_STOCK).
 * `orderIds` opsional: dipakai saat owner memilih hanya sebagian pesanan.
 */
export async function ambilDataProduksi(
  tenantId: string,
  opsi: { orderIds?: string[]; limit?: number } = {},
): Promise<DataProduksi> {
  // ── Pemilihan pesanan: SATU SUMBER KEBENARAN dengan badge "Perlu Diproses".
  // Dulu daftar ini hanya mengambil fulfillment `WAITING_STOCK`, sehingga:
  //   (a) pesanan yang stoknya sudah ada (SIAP_DIKEMAS) tidak pernah masuk lembar
  //       produksi — padahal barangnya tetap harus dikerjakan gudang, dan
  //   (b) pesanan batal ikut terhitung bila baris fulfillment-nya belum ditutup.
  // Pemilihan kini memakai `classifyWorkQueue` yang sama dengan halaman Pesanan —
  // daftar produksi dan badge menu tidak bisa beda lagi.
  const kandidat = await prisma.order.findMany({
    where: {
      tenantId,
      status: { in: ['NEW', 'CONFIRMED'] },
      ...(opsi.orderIds && opsi.orderIds.length > 0 ? { id: { in: opsi.orderIds } } : {}),
    },
    select: {
      id: true,
      externalOrderId: true,
      status: true,
      externalStatus: true,
      placedAt: true,
      shipByAt: true,
      fulfillmentOrders: {
        where: { status: { notIn: ['COMPLETED'] } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { status: true },
      },
      shipments: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { awb: true, status: true },
      },
      items: {
        select: {
          quantity: true,
          variant: { select: { sku: true, name: true, product: { select: { name: true } } } },
        },
      },
    },
    orderBy: { placedAt: 'asc' },
    take: opsi.limit ?? 400,
  });

  const baris: BarisProduksi[] = [];
  for (const o of kandidat) {
    const fo = o.fulfillmentOrders[0] ?? null;
    const shipment = o.shipments[0] ?? null;
    const antrean = classifyWorkQueue({
      orderStatus: o.status,
      externalStatus: o.externalStatus,
      fulfillmentStatus: fo?.status ?? null,
      shipmentStatus: shipment?.status ?? null,
      hasAwb: Boolean(shipment?.awb?.trim()),
    });
    // Batal / sudah dijemput kurir / sudah diterima → bukan pekerjaan produksi.
    if (!antrean.needsWork) continue;

    for (const item of o.items) {
      baris.push({
        orderId: o.id,
        externalOrderId: o.externalOrderId,
        placedAt: o.placedAt.toISOString(),
        shipByAt: o.shipByAt ? o.shipByAt.toISOString() : null,
        sku: item.variant?.sku ?? '(tanpa SKU)',
        produk: item.variant?.product?.name ?? '(tanpa nama)',
        varian: item.variant?.name ?? null,
        qty: item.quantity,
      });
    }
  }

  const sekarang = new Date();

  // Satu baris per PESANAN (bukan per item) untuk hitung mundur: yang penting
  // "pesanan mana yang paling cepat dibatalkan", beserta total unitnya.
  const perPesanan = new Map<string, PesananMendesak>();
  for (const b of baris) {
    if (!b.shipByAt) continue;
    const sisa = hitungSisaWaktu(b.shipByAt, sekarang);
    if (!sisa) continue;
    const ada = perPesanan.get(b.orderId);
    if (ada) {
      ada.qty += b.qty;
    } else {
      perPesanan.set(b.orderId, {
        orderId: b.orderId,
        externalOrderId: b.externalOrderId,
        nama: namaPendek(b.produk, b.varian),
        qty: b.qty,
        batasKirim: b.shipByAt,
        sisaTeks: sisa.teks,
        nada: sisa.nada,
        jam: sisa.jam,
      });
    }
  }

  const mendesak = [...perPesanan.values()].sort((a, b) => a.jam - b.jam).slice(0, 5);

  return {
    ...kelompokkanProduksi(baris),
    // Satu sumber kebenaran: sama persis dengan yang dicatat di tabel batch
    // (tanggal lokal server — bukan UTC, supaya tidak beda hari di waktu magrib).
    kodeBatch: buatKodeBatch(sekarang, 1),
    dicetakPada: sekarang,
    mendesak,
  };
}

/**
 * PDF lembar kerja produksi — sengaja sederhana dan bersih:
 *  - paling atas: section **PALING DEKAT DIBATALKAN OTOMATIS** (5 pesanan dengan
 *    batas kirim terdekat + hitung mundur, warna sesuai tingkat bahaya);
 *  - lalu daftar produk **hanya Produk · Qty** (semua resi yang sama digabung,
 *    nama diringkas `namaPendek()`, urutan SET dulu lalu jilid).
 * Tanpa kolom tanggal pesanan dan tanpa kolom tanda tangan — yang dibutuhkan
 * tim produksi hanya: apa yang dibuat, berapa, dan kapan batasnya.
 */
export async function buatPdfProduksi(data: DataProduksi): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const A4: [number, number] = [595.28, 841.89];
  const margin = 40;
  const lebarIsi = A4[0] - margin * 2;
  let page = doc.addPage(A4);
  let y = A4[1] - margin;

  const tulis = (isi: string, x: number, size = 10, tebal = false, warna = rgb(0.1, 0.1, 0.1)) => {
    page.drawText(amanUntukPdf(isi), { x, y, size, font: tebal ? bold : font, color: warna });
  };
  const garis = (yGaris: number) =>
    page.drawLine({
      start: { x: margin, y: yGaris },
      end: { x: margin + lebarIsi, y: yGaris },
      thickness: 0.5,
      color: rgb(0.75, 0.75, 0.75),
    });
  const halamanBaru = () => {
    page = doc.addPage(A4);
    y = A4[1] - margin;
    tulis('Daftar Produksi (lanjutan)', margin, 10, true);
    y -= 16;
  };

  tulis('DAFTAR PRODUKSI', margin, 16, true);
  y -= 22;
  tulis(`Batch ${data.kodeBatch}`, margin, 10, true);
  tulis(`Dicetak ${data.dicetakPada.toLocaleString('id-ID')}`, margin + 260, 9);
  y -= 14;
  tulis(`${data.totalPesanan} pesanan · ${data.totalUnit} unit`, margin, 10);
  y -= 12;

  // ── Section paling atas di dalam PDF: sisa waktu batal otomatis Shopee ──
  // Data sama persis dengan section halaman Produksi (`mendesak`), diurutkan
  // dari batas terdekat. Kosong → section tidak digambar sama sekali.
  if (data.mendesak.length > 0) {
    garis(y);
    y -= 15;
    tulis('PALING DEKAT DIBATALKAN OTOMATIS', margin, 9.5, true, rgb(0.65, 0.12, 0.08));
    y -= 12;
    tulis('Kalau batas kirim terlewat, Shopee membatalkan pesanannya sendiri.', margin, 7.5, false, rgb(0.45, 0.45, 0.45));
    y -= 15;
    tulis('Produk', margin, 8, true);
    tulis('Qty', margin + 212, 8, true);
    tulis('Deadline', margin + 252, 8, true);
    tulis('Sisa waktu', margin + 396, 8, true);
    y -= 10;
    garis(y);
    y -= 13;
    for (const m of data.mendesak) {
      if (y < 90) halamanBaru();
      const warna =
        m.nada === 'lewat' || m.nada === 'kritis'
          ? rgb(0.78, 0.1, 0.1)
          : m.nada === 'waspada'
            ? rgb(0.72, 0.48, 0.04)
            : rgb(0.35, 0.35, 0.35);
      tulis(m.nama, margin, 8.5);
      tulis(String(m.qty), margin + 212, 8.5);
      tulis(formatDeadline(m.batasKirim), margin + 252, 8.5);
      tulis(m.sisaTeks, margin + 396, 8.5, false, warna);
      y -= 12;
    }
    y -= 8;
  }

  garis(y);
  y -= 18;

  // ── Daftar produk: HANYA Produk · Qty (tanpa tanggal, tanpa keterangan) ──
  tulis('Produk', margin, 9, true);
  tulis('Qty', margin + 330, 9, true);
  y -= 11;
  garis(y);
  y -= 14;

  // SATU baris per produk: semua resi dengan produk sama digabung, karena tim
  // produksi membuat barangnya sekaligus — bukan per resi.
  for (const g of data.grup) {
    if (y < 100) halamanBaru();
    tulis(g.nama, margin, 9.5);
    tulis(String(g.totalUnit), margin + 330, 9.5);
    y -= 13;
  }

  if (data.grup.length === 0) {
    if (y < 100) halamanBaru();
    tulis('Tidak ada pesanan yang menunggu produksi.', margin, 10);
    y -= 16;
  }

  return doc.save();
}
