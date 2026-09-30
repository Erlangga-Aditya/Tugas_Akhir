import { type NextRequest } from 'next/server';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateShippingLabel } from '@/modules/integrations/application/sync.service';
import { verifyShippingLabel } from '@/modules/integrations/domain/labelBarcode';
import { prisma } from '@/shared/infrastructure/prisma';
import {
  getAuthContext,
  getRequestId,
  assertPermission,
} from '@/shared/application/routeHelpers';
import { handleRouteError } from '@/shared/application/apiResponse';
import { ValidationError } from '@/shared/errors/AppError';
import { logger } from '@/shared/observability/logger';

type Ctx = { params: Promise<{ orderId: string }> };

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/orders/[orderId]/print-label
 * Unduh label RESMI Shopee untuk satu pesanan.
 *
 * Mengembalikan file label persis seperti Shopee menerbitkannya (PDF, HTML, atau
 * ZIP untuk printer thermal) - tidak ada gambar ulang, tidak ada barcode buatan,
 * tidak ada data asumsi. Alur 4 langkah Shopee dijalankan di service layer.
 *
 * Untuk label PDF, isinya diperiksa lebih dulu: barcode di dalamnya dibaca dan
 * dicocokkan dengan nomor pesanan. Kalau barcode itu terbukti milik pesanan
 * LAIN, label tidak dikirim sama sekali - mencetak label yang salah membuat
 * paket dikirim dengan resi orang lain, dan itu jauh lebih mahal daripada
 * sekadar gagal mencetak.
 *
 * Kalau barcode tidak berhasil dibaca sama sekali, label tetap dikirim dengan
 * penanda `X-Label-Barcode: tidak-terbaca`. Memblokirnya akan membuat label
 * yang sah tidak bisa dicetak hanya karena pembaca kami tidak mengenali
 * formatnya.
 *
 * Respons:
 *  - 200 + file label (Content-Type dari Shopee / hasil yang terdeteksi)
 *  - 4xx/5xx + JSON berisi pesan error apa adanya (tidak pernah memakai label palsu)
 *
 * Body: { shopId?: string, packageNumber?: string }
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    assertPermission(ctx, 'order.pack');
    const { orderId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      shopId?: string;
      packageNumber?: string;
    };

    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId: ctx.tenantId },
      select: {
        externalOrderId: true,
        shipments: { select: { awb: true } },
      },
    });
    if (!order) {
      throw new ValidationError('Pesanan tidak ditemukan pada toko ini.');
    }

    const label = await generateShippingLabel(ctx.tenantId, body.shopId ?? '', orderId, body.packageNumber);

    const headers: Record<string, string> = {
      'Content-Type': label.contentType,
      'Content-Disposition': `inline; filename="${label.fileName}"`,
      'Content-Length': String(label.bytes.byteLength),
      'Cache-Control': 'no-store',
      'X-Request-Id': requestId,
      'X-Shopee-Document-Type': label.documentType,
    };

    // Hanya PDF yang punya barcode gambar. HTML dan ZIP tidak diperiksa, dan
    // itu dilaporkan apa adanya supaya tidak terbaca sebagai "sudah diperiksa".
    if (/pdf/i.test(label.contentType)) {
      const awb = order.shipments.map((s) => s.awb).find((v): v is string => Boolean(v)) ?? null;
      const workDir = await mkdtemp(join(tmpdir(), 'label-verify-'));
      try {
        const hasil = await verifyShippingLabel(
          Buffer.from(label.bytes),
          { orderSn: order.externalOrderId, awb },
          workDir,
        );

        if (hasil.barcodes.length === 0) {
          headers['X-Label-Barcode'] = 'tidak-terbaca';
          logger.warn('Label PDF terbit, tetapi barcode-nya tidak terbaca', {
            requestId,
            orderSn: order.externalOrderId,
          });
        } else {
          headers['X-Label-Barcode'] = hasil.ok ? 'cocok' : 'tidak-cocok';
          headers['X-Label-Barcode-Isi'] = encodeURIComponent(
            hasil.barcodes.map((b) => b.text).slice(0, 5).join(' | '),
          );
        }

        // Terbukti salah pesanan -> jangan pernah dikirim. Ini satu-satunya
        // keadaan yang memblokir, karena buktinya nyata dari label itu sendiri.
        if (hasil.barcodes.length > 0 && !hasil.ok) {
          throw new ValidationError(
            'Label yang diterbitkan Shopee tidak cocok dengan pesanan ini, jadi tidak dicetak. ' +
              'Cetak ulang label dari Seller Centre bila masalah berlanjut.',
            { orderSn: order.externalOrderId, masalah: hasil.problems },
          );
        }
      } catch (err) {
        if (err instanceof ValidationError) throw err;
        // Pembacaan barcode gagal karena sebab teknis (penerjemah PDF tidak
        // tersedia, mis.). Label tetap dikirim, tetapi statusnya jujur:
        // belum diverifikasi.
        headers['X-Label-Barcode'] = 'gagal-diperiksa';
        logger.warn('Pemeriksaan barcode label gagal', {
          requestId,
          orderSn: order.externalOrderId,
          message: (err as Error).message,
        });
      } finally {
        await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
      }
    } else {
      headers['X-Label-Barcode'] = 'tidak-diperiksa';
    }

    return new Response(new Uint8Array(label.bytes), { status: 200, headers });
  } catch (error) {
    // Log di server (operasional). Balasan ke klien tetap jujur: pesan error Shopee
    // diteruskan apa adanya, tidak pernah digantikan label buatan.
    logger.error('Gagal membuat label resmi Shopee', { requestId, message: (error as Error).message });
    return handleRouteError(error, requestId, request);
  }
}
