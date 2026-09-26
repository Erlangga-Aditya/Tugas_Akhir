import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/shared/infrastructure/prisma';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';
import { NotFoundError, ValidationError, BusinessRuleViolationError } from '@/shared/errors/AppError';
import { auditLog } from '@/modules/audit/application/auditLog.service';

type Ctx = { params: Promise<{ warehouseId: string }> };

const UpdateWarehouseSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

export async function GET(request: NextRequest, { params }: Ctx) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const { warehouseId } = await params;
    const warehouse = await prisma.warehouse.findFirst({
      where: { id: warehouseId, tenantId: ctx.tenantId },
      include: {
        _count: { select: { inventoryBalances: true } },
      },
    });
    if (!warehouse) throw new NotFoundError('Gudang', warehouseId);
    return successResponse(warehouse, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const { warehouseId } = await params;
    const body: unknown = await request.json();
    const parsed = UpdateWarehouseSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Data tidak valid.', { fields: parsed.error.flatten().fieldErrors });
    }

    const existing = await prisma.warehouse.findFirst({ where: { id: warehouseId, tenantId: ctx.tenantId } });
    if (!existing) throw new NotFoundError('Gudang', warehouseId);

    const updated = await prisma.warehouse.update({
      where: { id: warehouseId },
      data: {
        ...(parsed.data.name ? { name: parsed.data.name } : {}),
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
      },
    });

    await auditLog({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'warehouse_update',
      entityType: 'Warehouse',
      entityId: warehouseId,
      metadata: parsed.data,
    });

    return successResponse(updated, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const { warehouseId } = await params;

    const existing = await prisma.warehouse.findFirst({
      where: { id: warehouseId, tenantId: ctx.tenantId },
      include: { _count: { select: { inventoryBalances: true, fulfillmentOrders: true } } },
    });
    if (!existing) throw new NotFoundError('Gudang', warehouseId);

    // Prevent deleting warehouse with active inventory
    if (existing._count.inventoryBalances > 0) {
      throw new BusinessRuleViolationError(
        `Gudang ini memiliki ${existing._count.inventoryBalances} data inventori. Pindahkan stok terlebih dahulu sebelum menghapus gudang.`,
      );
    }

    // Soft-delete: deactivate instead of hard-delete to preserve fulfillment history
    await prisma.warehouse.update({
      where: { id: warehouseId },
      data: { status: 'INACTIVE' },
    });

    await auditLog({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'warehouse_deactivate',
      entityType: 'Warehouse',
      entityId: warehouseId,
      metadata: { name: existing.name, code: existing.code },
    });

    return successResponse({ deactivated: true, warehouseId }, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
