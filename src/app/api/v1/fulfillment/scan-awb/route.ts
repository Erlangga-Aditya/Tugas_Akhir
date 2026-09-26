import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { scanAwbForPacking } from '@/modules/fulfillment/application/scan-awb.usecase';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';
import { ValidationError } from '@/shared/errors/AppError';
import { broadcastSystemEvent } from '@/lib/sse';

export const dynamic = 'force-dynamic';

const ScanAwbSchema = z.object({
  scannedCode: z.string().min(1, 'Nomor resi tidak boleh kosong.'),
  /** Mode cepat: konfirmasi seluruh item picking tanpa scan per item (tercatat di audit log). */
  confirmPicking: z.boolean().optional(),
  /** Tetap packing walau stok kurang (stok menjadi minus) — harus aksi sadar operator. */
  allowNegativeStock: z.boolean().optional(),
});

/**
 * POST /api/v1/fulfillment/scan-awb
 *
 * Scan resi (AWB) untuk menyelesaikan packing.
 * Respons selalu menyebutkan keadaan sebenarnya lewat `code` + `stockDeducted`:
 *  - PACKED             → stok benar-benar sudah dikurangi pada request ini
 *  - ALREADY_PACKED     → sudah pernah dipacking (stok tidak dipotong ulang)
 *  - NEEDS_PICKING      → butuh konfirmasi picking (mode cepat) — stok BELUM dikurangi
 *  - WAITING_STOCK      → stok kurang, sertakan detail shortfall — stok BELUM dikurangi
 *  - NOT_QUEUED         → pesanan belum masuk antrian fulfillment
 *  - NOT_FOUND          → bukan nomor resi yang tersimpan pada toko
 */
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const parsed = ScanAwbSchema.safeParse(await request.json());
    if (!parsed.success) {
      throw new ValidationError('Kode scan tidak valid.', {
        fields: parsed.error.flatten().fieldErrors,
      });
    }

    const result = await scanAwbForPacking(ctx.tenantId, parsed.data.scannedCode, ctx.userId, {
      // Alur resmi sistem ini: TIDAK ada scan per produk, jadi item disiapkan
      // bersamaan saat resi discan — dan itu selalu tercatat di audit log.
      confirmPicking: parsed.data.confirmPicking ?? true,
      allowNegativeStock: parsed.data.allowNegativeStock,
    });

    // Real-time push hanya saat benar-benar ada perubahan stok/status pada
    // request ini — `stockDeducted` sudah dijamin jujur oleh use case.
    if (result.stockDeducted && result.deductedUnits > 0 && result.order) {
      broadcastSystemEvent('fulfillment:updated', {
        tenantId: ctx.tenantId,
        orderId: result.order.id,
        externalOrderId: result.order.externalOrderId,
        awb: result.order.awb ?? undefined,
        data: { code: result.code, deductedUnits: result.deductedUnits },
      });
    }

    return successResponse(result, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
