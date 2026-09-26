import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/shared/infrastructure/prisma';
import { successResponse, created, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';
import { ConflictError, ValidationError } from '@/shared/errors/AppError';
import { auditLog } from '@/modules/audit/application/auditLog.service';

const CreateWarehouseSchema = z.object({
  name: z.string().min(2).max(100),
  code: z.string().min(2).max(20).toUpperCase(),
  address: z.string().max(500).optional(),
});

/**
 * GET /api/v1/warehouses — list gudang dengan detail
 * POST /api/v1/warehouses — tambah gudang baru
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const warehouses = await prisma.warehouse.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, code: true, status: true, createdAt: true },
    });
    return successResponse(warehouses, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const body: unknown = await request.json();
    const parsed = CreateWarehouseSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Data gudang tidak valid.', { fields: parsed.error.flatten().fieldErrors });
    }

    // Check code uniqueness within tenant
    const existing = await prisma.warehouse.findFirst({
      where: { tenantId: ctx.tenantId, code: parsed.data.code },
    });
    if (existing) throw new ConflictError(`Kode gudang '${parsed.data.code}' sudah digunakan.`);

    const warehouse = await prisma.warehouse.create({
      data: {
        tenantId: ctx.tenantId,
        name: parsed.data.name,
        code: parsed.data.code,
        status: 'ACTIVE',
      },
    });

    await auditLog({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'warehouse_create',
      entityType: 'Warehouse',
      entityId: warehouse.id,
      metadata: { name: warehouse.name, code: warehouse.code },
    });

    return created(warehouse, requestId);
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
