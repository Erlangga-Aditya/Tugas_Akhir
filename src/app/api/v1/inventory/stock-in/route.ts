import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { receiveStock } from '@/modules/inventory/application/inventory.usecase';
import { retryWaitingStockOrders } from '@/modules/fulfillment/application/fulfillment.usecase';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId, assertRole } from '@/shared/application/routeHelpers';
import { ValidationError } from '@/shared/errors/AppError';
import { broadcastSystemEvent } from '@/lib/sse';
import { logger } from '@/shared/observability/logger';

export const dynamic = 'force-dynamic';

const StockInSchema = z.object({
  warehouseId: z.string().min(1),
  variantId: z.string().min(1),
  quantity: z.number().int().positive('Jumlah harus lebih dari 0.'),
  notes: z.string().max(500).optional(),
});

/**
 * POST /api/v1/inventory/stock-in
 *
 * Barang masuk gudang → dicatat sebagai LOT baru (dasar FIFO), lalu sistem langsung
 * mencoba mengalokasikannya ke pesanan yang tadinya "Menunggu Stok".
 * Semua user tenant boleh memakai ini (operator gudang), jejaknya masuk audit log.
 */
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    assertRole(ctx, 'STAFF');

    const parsed = StockInSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError('Data stok masuk tidak valid.', {
        fields: parsed.error.flatten().fieldErrors,
      });
    }

    await receiveStock(ctx.tenantId, parsed.data, ctx.userId);

    // Barang baru masuk → pesanan yang menunggu stok bisa lanjut.
    let stockRetry: { advanced: string[]; stillWaiting: string[] } | null = null;
    try {
      stockRetry = await retryWaitingStockOrders(ctx.tenantId, parsed.data.warehouseId, ctx.userId);
    } catch (err) {
      logger.warn('Retry alokasi stok setelah stok masuk gagal', { error: (err as Error).message });
    }

    broadcastSystemEvent('inventory:updated', {
      tenantId: ctx.tenantId,
      data: { variantId: parsed.data.variantId, added: parsed.data.quantity, advanced: stockRetry?.advanced.length ?? 0 },
    });

    return successResponse(
      {
        message:
          stockRetry && stockRetry.advanced.length > 0
            ? `Stok bertambah ${parsed.data.quantity} unit. ${stockRetry.advanced.length} pesanan langsung siap diproses.`
            : `Stok bertambah ${parsed.data.quantity} unit (dicatat sebagai lot baru, keluar FIFO).`,
        ...(stockRetry ? { stockRetry } : {}),
      },
      { requestId },
    );
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
