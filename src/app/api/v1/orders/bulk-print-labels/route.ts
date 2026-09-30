import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/shared/infrastructure/prisma';
import { handleRouteError } from '@/shared/application/apiResponse';
import {
  getAuthContext,
  getRequestId,
  assertPermission,
} from '@/shared/application/routeHelpers';
import { ValidationError } from '@/shared/errors/AppError';
import { generateShippingLabel } from '@/modules/integrations/application/sync.service';
import { mergePdfs } from './mergePdfs';
import { logger } from '@/shared/observability/logger';

/**
 * Jumlah alasan gagal terbanyak yang dikirim lewat header.
 *
 * Header HTTP punya batas panjang dan proxy menolaknya bila terlalu panjang.
 * Sepuluh alasan sudah cukup untuk menuntun operator memperbaiki masalah yang
 * paling sering muncul; sisanya dibaca dari log server.
 */
const MAX_HEADER_REASONS = 10;

export const dynamic = 'force-dynamic';

const BulkSchema = z.object({
  orderIds: z
    .array(z.string().min(1))
    .min(1, 'Pilih minimal satu pesanan.')
    .max(50, 'Maksimal 50 pesanan per invocation.'),
  shopId: z.string().optional(),
});

/**
 * POST /api/v1/orders/bulk-print-labels
 *
 * Unduh label RESMI Shopee untuk banyak pesanan sekaligus, lalu satukan jadi
 * satu PDF supaya bisa langsung dicetak beruntun.
 *
 * Yang dikembalikan HANYA PDF asli dari Shopee. Tidak ada label yang digambar
 * ulang, tidak ada barcode buatan, tidak ada nomor asumsi. Kalau satu pesanan
 * gagal, pesanan lain tetap dicetak dan namanya dilaporkan terpisah supaya
 * operator tahu persis mana yang perlu diulang — bukan satu galat yang
 * membatalkan semuanya.
 *
 * Respons:
 *  - 200 + PDF gabungan (X-Label-Failed-Izes + X-Label-Izes dalam header)
 *  - 4xx/5xx + JSON bila TIDAK ADA satu pun label yang berhasil
 */
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    assertPermission(ctx, 'order.pack');

    const body: unknown = await request.json();
    const parsed = BulkSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Data tidak valid.', { fields: parsed.error.flatten().fieldErrors });
    }
    const { orderIds, shopId } = parsed.data;

    const orders = await prisma.order.findMany({
      where: { id: { in: orderIds }, tenantId: ctx.tenantId },
      select: { id: true, shopId: true, externalOrderId: true },
    });
    const byId = new Map(orders.map((o) => [o.id, o]));

    type Ok = { orderId: string; externalOrderId: string; bytes: Uint8Array };
    type Failed = { orderId: string; externalOrderId: string; reason: string };
    const okList: Ok[] = [];
    const failed: Failed[] = [];

    for (const orderId of orderIds) {
      const order = byId.get(orderId);
      if (!order) {
        failed.push({ orderId, externalOrderId: orderId, reason: 'Pesanan tidak ditemukan.' });
        continue;
      }
      try {
        const label = await generateShippingLabel(
          ctx.tenantId,
          shopId ?? order.shopId,
          orderId,
          undefined,
        );
        // Hanya PDF yang digabung. HTML/ZIP tidak bisa masuk satu berkas
        // cetak; pesanan seperti itu dilaporkan supaya operator mengunduhnya
        // satu per satu lewat tombol biasa, bukan diam-diam kehilangan label.
        if (!/pdf/i.test(label.contentType)) {
          failed.push({
            orderId,
            externalOrderId: order.externalOrderId,
            reason: `Shopee mengirim label ${label.documentType}, bukan PDF. Unduh satu per satu.`,
          });
          continue;
        }
        okList.push({ orderId, externalOrderId: order.externalOrderId, bytes: new Uint8Array(label.bytes) });
      } catch (err) {
        failed.push({ orderId, externalOrderId: order.externalOrderId, reason: (err as Error).message });
      }
    }

    if (okList.length === 0) {
      // Tidak ada yang bisa dicetak — lebih baik pesan jelas daripada PDF kosong
      // yang membuat operator mengira semua beres.
      throw new ValidationError('Tidak ada label yang bisa dicetak.', {
        failed: failed.map((f) => `${f.externalOrderId}: ${f.reason}`),
      });
    }

    // Label yang gagal di-parse saat penggabungan digabung ke daftar gagal,
    // bukan dihitung sebagai berhasil. Kalau tidak, operator mencari label
    // yang ternyata tidak pernah tercetak.
    const merged = await mergePdfs(okList);
    const allFailed = [...failed, ...merged.dropped];

    // PDF tanpa halaman sama sekali tidak boleh dikirim sebagai 200: operator
    // akan membuka berkas kosong dan mengira labelnya sudah tercetak.
    if (merged.pages === 0) {
      throw new ValidationError('Label yang dihasilkan tidak punya halaman yang bisa dicetak.', {
        failed: allFailed.map((f) => `${f.externalOrderId}: ${f.reason}`),
      });
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="label-shopee.pdf"',
      'Content-Length': String(merged.bytes.byteLength),
      'Cache-Control': 'no-store',
      'X-Request-Id': requestId,
      // Berapa pesanan yang benar-benar tercetak, bukan berapa yang dicoba.
      'X-Label-Ok': String(okList.length - merged.dropped.length),
      'X-Label-Gagal': String(allFailed.length),
      'X-Label-Halaman': String(merged.pages),
    };
    if (allFailed.length > 0) {
      // Header HTTP punya batas panjang (nginx menolak sekitar 8 KB). Dengan
      // 50 pesanan yang semuanya gagal, daftar penuh bisa melewati batas itu
      // dan responsnya ditolak proxy - justru saat operator paling butuh
      // penjelasan. Jadi yang dikirim hanya beberapa alasan pertama, sementara
      // jumlah totalnya tetap dilaporkan apa adanya di X-Label-Gagal.
      //
      // Rincian lengkap setiap kegagalan tetap tercatat di log server.
      const ringkas = allFailed.slice(0, MAX_HEADER_REASONS);
      const sisa = allFailed.length - ringkas.length;
      const teks =
        ringkas.map((f) => `${f.externalOrderId}: ${f.reason}`).join(' | ') +
        (sisa > 0 ? ` | ... dan ${sisa} lagi (lihat X-Label-Gagal)` : '');
      headers['X-Label-Gagal-Daftar'] = encodeURIComponent(teks);
    }

    if (allFailed.length > 0) {
      logger.warn('Bulk cetak label: sebagian gagal', {
        requestId,
        ok: okList.length - merged.dropped.length,
        gagal: allFailed.length,
        halaman: merged.pages,
      });
    }

    return new Response(new Uint8Array(merged.bytes), { status: 200, headers });
  } catch (error) {
    logger.error('Gagal membuat label massal', { requestId, message: (error as Error).message });
    return handleRouteError(error, requestId, request);
  }
}
