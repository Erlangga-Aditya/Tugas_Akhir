import { type NextRequest } from 'next/server';
import { resetAllStockToZero } from '@/modules/inventory/application/inventory.usecase';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId, assertPermission, assertRole } from '@/shared/application/routeHelpers';

/**
 * POST /api/v1/inventory/reset-all
 *
 * Mengosongkan stok fisik semua varian menjadi 0. Hanya OWNER: tindakan ini
 * menghapus angka stok yang ada (jejaknya tetap tersimpan di ledger & audit).
 */
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    assertPermission(ctx, 'inventory.adjust');
    assertRole(ctx, 'OWNER');

    const body = (await request.json().catch(() => ({}))) as { notes?: unknown };
    const hasil = await resetAllStockToZero(
      ctx.tenantId,
      ctx.userId,
      body.notes == null ? undefined : String(body.notes),
    );
    return successResponse(
      {
        message:
          hasil.varian === 0
            ? 'Semua stok sudah 0 — tidak ada yang perlu diubah.'
            : `${hasil.varian} varian dikosongkan (${hasil.unitDisesuaikan} unit disesuaikan).`,
        ...hasil,
      },
      { requestId },
    );
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
