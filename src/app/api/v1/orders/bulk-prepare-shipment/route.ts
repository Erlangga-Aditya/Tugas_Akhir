import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/shared/infrastructure/prisma';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import {
  getAuthContext,
  getRequestId,
  assertPermission,
} from '@/shared/application/routeHelpers';
import { ValidationError } from '@/shared/errors/AppError';
import { processOrderForFulfillment, retryWaitingStockOrders } from '@/modules/fulfillment/application/fulfillment.usecase';
import { arrangeShipmentForOrder } from '@/modules/integrations/application/sync.service';
import { logger } from '@/shared/observability/logger';

export const dynamic = 'force-dynamic';

const BulkSchema = z.object({
  orderIds: z.array(z.string().min(1)).min(1, 'Pilih minimal satu pesanan.').max(50, 'Maksimal 50 pesanan per invocation.'),
  shopId: z.string().optional(),
});

/**
 * POST /api/v1/orders/bulk-prepare-shipment
 *
 * Ambil resi untuk BANYAK pesanan sekaligus, jadi operator tidak perlu
 * klik satu per satu. Satu per satu untuk 30 pesanan berarti 30 klik dan 30
 * kali menunggu; kalau salah satu gagal, yang lain tidak boleh ikut berhenti.
 *
 * Prinsipnya: partial success. Setiap pesanan diproses independen, hasilnya
 * dikembalikan per-item. Jadi operator melihat persis mana yang berhasil dan
 * mana yang perlu dicoba lagi, bukan satu pesan galat yang tidak jelas.
 */
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    assertPermission(ctx, 'order.prepare_shipment');

    const body: unknown = await request.json();
    const parsed = BulkSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Data tidak valid.', { fields: parsed.error.flatten().fieldErrors });
    }
    const { orderIds, shopId } = parsed.data;

    const warehouse = await prisma.warehouse.findFirst({
      where: { tenantId: ctx.tenantId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!warehouse) {
      throw new ValidationError('Belum ada gudang aktif. Buat gudang dulu di menu Pengaturan.');
    }

    type Result = {
      orderId: string;
      externalOrderId: string;
      status: 'OK' | 'GAGAL';
      trackingNumber: string | null;
      message: string;
    };
    const results: Result[] = [];

    for (const orderId of orderIds) {
      const order = await prisma.order.findFirst({
        where: { id: orderId, tenantId: ctx.tenantId },
        select: { id: true, shopId: true, status: true, externalOrderId: true },
      });

      if (!order) {
        results.push({ orderId, externalOrderId: orderId, status: 'GAGAL', trackingNumber: null, message: 'Pesanan tidak ditemukan.' });
        continue;
      }
      if (order.status !== 'CONFIRMED') {
        results.push({
          orderId,
          externalOrderId: order.externalOrderId,
          status: 'GAGAL',
          trackingNumber: null,
          message: `Status pesanan ${order.status}, belum bisa dikirim.`,
        });
        continue;
      }

      // Alokasikan stok dulu; kalau stok kurang, coba alokasi ulang (sama
      // seperti satu per satu, tapi di sini untuk semua).
      const fulfillment = await processOrderForFulfillment(ctx.tenantId, orderId, warehouse.id, ctx.userId);
      let stockNote = '';
      if (!fulfillment.success) {
        const retry = await retryWaitingStockOrders(ctx.tenantId, warehouse.id, ctx.userId);
        stockNote = retry.advanced.length > 0 ? ' Stok dialokasikan ulang.' : ' Stok gudang belum cukup.';
      }

      // Minta nomor resi ke Shopee. Kegagalan di sini TIDAK menghentikan
      // pesanan lain — itu inti dari partial success.
      try {
        const shipment = await arrangeShipmentForOrder(
          ctx.tenantId,
          shopId ?? order.shopId,
          orderId,
          {},
          ctx.userId,
        );
        results.push({
          orderId,
          externalOrderId: order.externalOrderId,
          status: shipment.success ? 'OK' : 'GAGAL',
          trackingNumber: shipment.trackingNumber ?? null,
          message: shipment.message + stockNote,
        });
      } catch (err) {
        results.push({
          orderId,
          externalOrderId: order.externalOrderId,
          status: 'GAGAL',
          trackingNumber: null,
          message: (err as Error).message + stockNote,
        });
      }
    }

    const okCount = results.filter((r) => r.status === 'OK').length;
    const failCount = results.length - okCount;

    if (failCount > 0) {
      logger.warn('Bulk ambil resi: sebagian gagal', { requestId, okCount, failCount, total: results.length });
    }

    return successResponse(
      {
        summary: { total: results.length, ok: okCount, gagal: failCount },
        results,
        message:
          failCount === 0
            ? `Semua ${okCount} resi berhasil diambil.`
            : `${okCount} berhasil, ${failCount} gagal. Lihat detail per pesanan.`,
      },
      { requestId },
    );
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
