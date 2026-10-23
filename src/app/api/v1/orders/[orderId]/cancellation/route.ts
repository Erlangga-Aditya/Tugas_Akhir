import { type NextRequest } from 'next/server';
import { approveBuyerCancellationForOrder } from '@/modules/integrations/application/sync.service';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId, assertPermission } from '@/shared/application/routeHelpers';
import { BusinessRuleViolationError } from '@/shared/errors/AppError';

/**
 * POST /api/v1/orders/[orderId]/cancellation
 *
 * Menyetujui pembatalan yang diajukan pembeli. Body: `{ "operation": "ACCEPT" }`.
 *
 * Mengapa hanya ACCEPT: Shopee Open Platform v2 tidak menyediakan endpoint untuk
 * MENOLAK pembatalan pembeli (hanya `order/cancel_order`). Penolakan dilakukan di
 * Seller Centre, dan tombolnya sengaja tidak ditampilkan di aplikasi.
 *
 * Hak akses: izin `order.cancel` DAN peran OWNER. Pemeriksaan peran dilakukan di
 * usecase (`checkCancelApproval`) supaya aturan yang sama dipakai UI.
 */
export async function POST(request: NextRequest, konteks: { params: Promise<{ orderId: string }> }) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    assertPermission(ctx, 'order.cancel');

    const body = (await request.json().catch(() => ({}))) as { operation?: string };
    const operasi = String(body.operation ?? 'ACCEPT').toUpperCase();
    if (operasi !== 'ACCEPT') {
      throw new BusinessRuleViolationError(
        'Menolak pembatalan belum tersedia di Shopee Open Platform. Tanggapi penolakan di Seller Centre.',
      );
    }

    const { orderId } = await konteks.params;
    const hasil = await approveBuyerCancellationForOrder(ctx.tenantId, orderId, ctx.userId, ctx.role);

    if (!hasil.ok) throw new BusinessRuleViolationError(hasil.message);
    return successResponse({ message: hasil.message }, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
