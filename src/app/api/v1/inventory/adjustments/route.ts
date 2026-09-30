import { type NextRequest } from 'next/server';
import {
  adjustStock,
  AdjustStockSchema,
} from '@/modules/inventory/application/inventory.usecase';
import { retryWaitingStockOrders } from '@/modules/fulfillment/application/fulfillment.usecase';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import {
  getAuthContext,
  getRequestId,
  assertPermission,
} from '@/shared/application/routeHelpers';
import { ValidationError } from '@/shared/errors/AppError';
import { logger } from '@/shared/observability/logger';

// POST /api/v1/inventory/adjustments
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);

  try {
    const ctx = getAuthContext(request);
    assertPermission(ctx, 'inventory.adjust'); // Koreksi stok mengubah angka resmi gudang

    const body: unknown = await request.json();
    const parsed = AdjustStockSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError('Data penyesuaian tidak valid.', {
        fields: parsed.error.flatten().fieldErrors,
      });
    }

    const result = await adjustStock(ctx.tenantId, parsed.data, ctx.userId);

    // Stok bertambah → coba alokasikan ke pesanan yang tadinya kekurangan stok.
    // Tanpa ini pesanan WAITING_STOCK bisa macet walau stok sudah masuk.
    //
    // Syaratnya `delta !== 0`, bukan hanya `> 0`: penyesuaian yang menaikkan
    // stok dari angka negatif (mis. -2 → 0 karena hasil hitung fisik) juga
    // membuat pesanan bisa lanjut, dan `delta > 0` dalam bentuk lama
    // melewatkan kasus itu.
    let stockRetry: { advanced: string[]; stillWaiting: string[] } | null = null;
    if (result.delta !== 0) {
      try {
        stockRetry = await retryWaitingStockOrders(ctx.tenantId, parsed.data.warehouseId, ctx.userId);
      } catch (err) {
        logger.warn('Retry alokasi stok setelah penyesuaian gagal', { error: (err as Error).message });
      }
    }

    return successResponse(
      {
        message: result.message,
        previousOnHand: result.previousOnHand,
        countedOnHand: result.countedOnHand,
        delta: result.delta,
        ...(stockRetry ? { stockRetry } : {}),
      },
      { requestId },
    );
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
