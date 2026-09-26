import { type NextRequest } from 'next/server';
import { prisma } from '@/shared/infrastructure/prisma';
import { processOrderForFulfillment, retryWaitingStockOrders } from '@/modules/fulfillment/application/fulfillment.usecase';
import { arrangeShipmentForOrder } from '@/modules/integrations/application/sync.service';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';
import { ValidationError, NotFoundError } from '@/shared/errors/AppError';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ orderId: string }> };

/**
 * POST /api/v1/orders/:orderId/prepare-shipment
 *
 * SATU aksi untuk operator: "Ambil Resi dari Shopee".
 *   1. Pesanan dimasukkan ke antrian kerja (stok dialokasikan bila tersedia).
 *   2. Sistem meminta nomor resi ke Shopee untuk pesanan itu.
 * Hasilnya jujur: kalau belum berhasil, `success: false` + alasannya.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const { orderId } = await params;

    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId: ctx.tenantId },
      select: { id: true, shopId: true, status: true, externalOrderId: true },
    });
    if (!order) throw new NotFoundError('Pesanan', orderId);
    if (order.status !== 'CONFIRMED') {
      throw new ValidationError(
        `Pesanan ${order.externalOrderId} belum bisa dikirim (status: ${order.status}).`,
      );
    }

    const warehouse = await prisma.warehouse.findFirst({
      where: { tenantId: ctx.tenantId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!warehouse) throw new ValidationError('Belum ada gudang aktif. Buat gudang dulu di menu Pengaturan.');

    // 1. Masuk antrian kerja (idempoten: kalau sudah ada, tidak dibuat dobel).
    const fulfillment = await processOrderForFulfillment(ctx.tenantId, orderId, warehouse.id, ctx.userId);

    // Kalau stok kurang, coba alokasikan ulang supaya tidak langsung macet.
    let stockNote = '';
    if (!fulfillment.success) {
      const retry = await retryWaitingStockOrders(ctx.tenantId, warehouse.id, ctx.userId);
      stockNote =
        retry.advanced.length > 0
          ? ' Stok sudah dialokasikan ulang dan pesanan siap dikemas.'
          : ' Catatan: stok gudang belum cukup — periksa menu Stok Gudang.';
    }

    // 2. Minta nomor resi ke Shopee.
    const shipment = await arrangeShipmentForOrder(
      ctx.tenantId,
      order.shopId,
      orderId,
      {},
      ctx.userId,
    );

    return successResponse(
      {
        ...shipment,
        fulfillmentOrderId: fulfillment.fulfillmentOrderId,
        stockReady: fulfillment.success,
        message: shipment.success
          ? `Resi berhasil dibuat: ${shipment.trackingNumber ?? 'menunggu dari Shopee'}.${stockNote}`
          : `Pesanan sudah masuk antrian kerja, tapi resi belum berhasil dibuat: ${
              shipment.message || 'coba lagi beberapa saat lagi'
            }.${stockNote}`,
      },
      { requestId },
    );
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
