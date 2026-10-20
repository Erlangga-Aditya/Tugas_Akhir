import { type NextRequest } from 'next/server';
import { prisma } from '@/shared/infrastructure/prisma';
import { countOrderQueue } from '@/modules/fulfillment/application/order-queue.usecase';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import {
  getAuthContext,
  getRequestId,
  assertPermission,
} from '@/shared/application/routeHelpers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/orders/badge
 *
 * Angka badge di menu "Pesanan & Pengiriman".
 *
 * Angkanya HARUS sama dengan kartu "Perlu Diproses" di halaman Pesanan, karena
 * keduanya menjawab pertanyaan yang sama: "berapa pesanan yang masih harus
 * saya kerjakan?". Sebelumnya badge memakai rumus sendiri (pesanan CONFIRMED
 * yang fulfillment-nya belum selesai) sehingga menampilkan 68 saat kartu
 * menunjukkan 31 — dua angka berbeda di satu layar.
 *
 * Definisi tunggalnya ada di `order-queue.usecase.ts` (dipakai juga oleh kartu).
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    assertPermission(ctx, 'page.orders');

    const [kartu, newest] = await Promise.all([
      // Badge tidak mengikuti filter tanggal: ia menjawab "ada berapa pekerjaan
      // yang belum selesai", bukan "berapa pada hari tertentu".
      countOrderQueue(ctx.tenantId, { from: null, to: null }),
      prisma.order.findFirst({
        where: { tenantId: ctx.tenantId, status: { in: ['NEW', 'CONFIRMED'] } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    return successResponse(
      {
        /** `count` = perlu diproses (sama dengan kartu di halaman Pesanan). */
        count: kartu.perluDiproses,
        notQueued: kartu.pesananBaru,
        belumResi: kartu.pesananBaru,
        sudahResi: kartu.sudahResi,
        newestOrderAt: newest?.createdAt?.toISOString() ?? null,
      },
      { requestId },
    );
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
