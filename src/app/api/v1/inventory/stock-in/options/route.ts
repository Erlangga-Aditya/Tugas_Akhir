import { type NextRequest } from 'next/server';
import { listShopeeSourcedVariants } from '@/modules/inventory/application/inventory.usecase';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId, getQueryParam } from '@/shared/application/routeHelpers';
import { prisma } from '@/shared/infrastructure/prisma';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/inventory/stock-in/options?search=&warehouseId=
 *
 * Daftar produk untuk kotak "Tambah Stok" — HANYA produk Shopee asli
 * (varian yang punya mapping hasil sinkronisasi Shopee Open Platform).
 * Setiap baris menyertakan stok saat ini + lot tertua yang masih tersisa (info FIFO).
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    let warehouseId: string | null = getQueryParam(request, 'warehouseId') ?? null;

    if (!warehouseId) {
      const warehouse = await prisma.warehouse.findFirst({
        where: { tenantId: ctx.tenantId, status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      warehouseId = warehouse?.id ?? null;
    }

    const items = await listShopeeSourcedVariants(
      ctx.tenantId,
      warehouseId,
      getQueryParam(request, 'search'),
    );

    return successResponse(
      { warehouseId, items, total: items.length },
      { requestId },
    );
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
