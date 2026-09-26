import { z } from 'zod';
import { prisma } from '@/shared/infrastructure/prisma';
import type { ShipmentStatus } from '@prisma/client';
import {
  NotFoundError,
  ValidationError,
  BusinessRuleViolationError,
} from '@/shared/errors/AppError';
import { auditLog } from '@/modules/audit/application/auditLog.service';

export const CreateShipmentSchema = z.object({
  orderId: z.string().min(1),
  carrier: z.string().min(1).max(100),
  awb: z.string().max(100).optional(),
});



export async function createShipment(
  tenantId: string,
  input: z.infer<typeof CreateShipmentSchema>,
  actorId: string,
) {
  const parsed = CreateShipmentSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError('Data pengiriman tidak valid.', { fields: parsed.error.flatten().fieldErrors });

  const order = await prisma.order.findFirst({ where: { id: parsed.data.orderId, tenantId }, include: { shipments: true } });
  if (!order) throw new NotFoundError('Pesanan', parsed.data.orderId);

  const activeShipment = order.shipments.find((s) => !['DELIVERED', 'FAILED', 'RETURNED'].includes(s.status));
  if (activeShipment) {
    throw new BusinessRuleViolationError('Pesanan ini sudah memiliki pengiriman aktif.', { existingShipmentId: activeShipment.id });
  }

  const shipment = await prisma.$transaction(async (tx) => {
    const created = await tx.shipment.create({
      data: { orderId: parsed.data.orderId, carrier: parsed.data.carrier, awb: parsed.data.awb ?? null, status: 'READY_TO_SHIP' },
    });
    await tx.shipmentEvent.create({
      data: { shipmentId: created.id, status: 'READY_TO_SHIP', description: `Label pengiriman dibuat — kurir ${parsed.data.carrier}.`, occurredAt: new Date() },
    });
    return created;
  });

  await auditLog({ tenantId, actorId, action: 'shipment_create', entityType: 'Shipment', entityId: shipment.id, metadata: { orderId: parsed.data.orderId, carrier: parsed.data.carrier, awb: parsed.data.awb } });
  return shipment;
}

export async function listShipments(
  tenantId: string,
  options: { status?: ShipmentStatus; carrier?: string; search?: string; page?: number; pageSize?: number } = {},
) {
  const { status, carrier, search, page = 1, pageSize = 20 } = options;
  const skip = (page - 1) * pageSize;

  const where = {
    order: { tenantId },
    ...(status ? { status } : {}),
    ...(carrier ? { carrier: { contains: carrier } } : {}),
    ...(search
      ? { OR: [
          { awb: { contains: search } },
          { order: { externalOrderId: { contains: search } } },
          { order: { buyerName: { contains: search } } },
        ] }
      : {}),
  };

  const [shipments, total] = await Promise.all([
    prisma.shipment.findMany({
      where,
      include: {
        order: { select: { id: true, externalOrderId: true, buyerName: true, buyerPhone: true, status: true, shop: { select: { name: true, provider: true } } } },
        events: { orderBy: { occurredAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.shipment.count({ where }),
  ]);

  return {
    items: shipments.map((s) => ({
      id: s.id,
      orderId: s.orderId,
      externalOrderId: s.order.externalOrderId,
      shopName: s.order.shop.name,
      buyerName: s.order.buyerName,
      carrier: s.carrier,
      awb: s.awb,
      status: s.status,
      shippedAt: s.shippedAt,
      deliveredAt: s.deliveredAt,
      createdAt: s.createdAt,
      latestEvent: s.events[0] || null,
    })),
    pagination: { total, page, pageSize, hasMore: skip + pageSize < total },
  };
}

export async function getShipmentById(tenantId: string, shipmentId: string) {
  const shipment = await prisma.shipment.findFirst({
    where: { id: shipmentId, order: { tenantId } },
    include: {
      order: { include: { shop: { select: { name: true, provider: true } }, items: { include: { variant: { select: { sku: true, name: true } } } } } },
      events: { orderBy: { occurredAt: 'desc' } },
    },
  });
  if (!shipment) throw new NotFoundError('Pengiriman', shipmentId);
  return shipment;
}
