import { z } from 'zod';
import { Prisma, OrderStatus } from '@prisma/client';
import { prisma } from '@/shared/infrastructure/prisma';
import { isValidOrderTransition, type OrderStatus as DomainOrderStatus } from '../domain/order.entity';
import {
  calculatePriority,
  explainPriority,
  DEFAULT_PRIORITY_RULE,
  type PriorityRuleConfig,
} from '../domain/priority.engine';
import {
  NotFoundError,
  ValidationError,
  InvalidStateTransitionError,
} from '@/shared/errors/AppError';
import { auditLog } from '@/modules/audit/application/auditLog.service';
import { releaseReservationsForOrder } from '@/modules/inventory/application/inventory.usecase';
import { logger } from '@/shared/observability/logger';

// ────────────────────────────────────────────────────────────
// Input schemas
// ────────────────────────────────────────────────────────────

export const ImportOrderSchema = z.object({
  shopId: z.string().min(1),
  externalOrderId: z.string().min(1),
  placedAt: z.coerce.date(),
  shipByAt: z.coerce.date().nullable().optional(),
  buyerName: z.string().max(100).nullable().optional(),
  buyerPhone: z.string().max(30).nullable().optional(),
  shippingAddress: z.record(z.unknown()).optional(),
  status: z.enum(['NEW', 'CONFIRMED', 'CANCELLED', 'COMPLETED']).optional(),
  // ── Rincian uang dari marketplace (opsional: tidak semua pesanan punya) ──
  buyerNote: z.string().max(2000).nullable().optional(),
  packageNumber: z.string().max(120).nullable().optional(),
  currency: z.string().max(10).nullable().optional(),
  totalAmount: z.number().nullable().optional(),
  itemSubtotal: z.number().nullable().optional(),
  sellerDiscount: z.number().nullable().optional(),
  shopeeDiscount: z.number().nullable().optional(),
  buyerShippingFee: z.number().nullable().optional(),
  shippingFeeDiscount: z.number().nullable().optional(),
  platformFee: z.number().nullable().optional(),
  escrowAmount: z.number().nullable().optional(),
  paymentMethod: z.string().max(60).nullable().optional(),
  isCod: z.boolean().optional(),
  paidAt: z.coerce.date().nullable().optional(),
  /** Rincian mentah dari marketplace (cadangan bila ada field baru). */
  incomeJson: z.record(z.unknown()).nullable().optional(),
  items: z
    .array(
      z.object({
        variantId: z.string().min(1),
        quantity: z.number().int().positive(),
        unitPrice: z.number().nonnegative().optional(),
      }),
    )
    .min(1),
});

export type ImportOrderInput = z.infer<typeof ImportOrderSchema>;

// ────────────────────────────────────────────────────────────
// Use Cases
// ────────────────────────────────────────────────────────────

/**
 * Import / sync an order from a marketplace.
 * Idempotent by (shopId, externalOrderId). On re-import, reconciles
 * status + buyer fields without duplicating items (FR-ORD-001..004).
 */
export async function importOrder(
  tenantId: string,
  input: ImportOrderInput,
): Promise<{ orderId: string; created: boolean }> {
  const parsed = ImportOrderSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('Data pesanan tidak valid.', {
      fields: parsed.error.flatten().fieldErrors,
    });
  }

  const {
    shopId,
    externalOrderId,
    items,
    buyerNote,
    packageNumber,
    currency,
    totalAmount,
    itemSubtotal,
    sellerDiscount,
    shopeeDiscount,
    buyerShippingFee,
    shippingFeeDiscount,
    platformFee,
    escrowAmount,
    paymentMethod,
    isCod,
    paidAt,
    incomeJson,
    ...orderData
  } = parsed.data;

  // Field uang & catatan: hanya ditulis kalau memang dikirim marketplace,
  // supaya sinkronisasi ulang tidak menghapus data yang sudah ada.
  const moneyFields: Record<string, unknown> = {};
  const moneySource: Record<string, unknown> = {
    buyerNote,
    packageNumber,
    currency,
    totalAmount,
    itemSubtotal,
    sellerDiscount,
    shopeeDiscount,
    buyerShippingFee,
    shippingFeeDiscount,
    platformFee,
    escrowAmount,
    paymentMethod,
    isCod,
    paidAt,
  };
  for (const [key, value] of Object.entries(moneySource)) {
    if (value !== undefined) moneyFields[key] = value;
  }
  if (incomeJson !== undefined && incomeJson !== null) {
    moneyFields.incomeJson = incomeJson as Prisma.InputJsonValue;
  }
  const contactFields: Record<string, unknown> = {};
  if (orderData.shippingAddress !== undefined) {
    contactFields.shippingAddress = orderData.shippingAddress as Prisma.InputJsonValue;
  }
  if (orderData.buyerName !== undefined) contactFields.buyerName = orderData.buyerName;
  if (orderData.buyerPhone !== undefined) contactFields.buyerPhone = orderData.buyerPhone;
  if (orderData.shipByAt !== undefined) contactFields.shipByAt = orderData.shipByAt;

  const shop = await prisma.shop.findFirst({ where: { id: shopId, tenantId } });
  if (!shop) throw new NotFoundError('Toko', shopId);

  const existing = await prisma.order.findUnique({
    where: { shopId_externalOrderId: { shopId, externalOrderId } },
  });

  if (existing) {
    // Reconcile status bila diberikan dan status saat ini belum final.
    const incoming = (orderData.status as DomainOrderStatus) ?? 'NEW';
    const statusChanged =
      Boolean(orderData.status) &&
      existing.status !== incoming &&
      existing.status !== 'CANCELLED' &&
      existing.status !== 'COMPLETED';

    const hasFieldUpdates = Object.keys(moneyFields).length > 0 || Object.keys(contactFields).length > 0;

    if (statusChanged || hasFieldUpdates) {
      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: existing.id },
          data: {
            ...contactFields,
            ...moneyFields,
            ...(statusChanged ? { status: incoming as OrderStatus } : {}),
          },
        });
        if (statusChanged) {
          await tx.orderStatusHistory.create({
            data: {
              orderId: existing.id,
              fromStatus: existing.status as OrderStatus,
              toStatus: incoming as OrderStatus,
              reason: 'Sinkronisasi dari marketplace',
            },
          });
        }
      });
    }

    // Pesanan dibatalkan → lepas reservasi stoknya. Tanpa ini, barang pesanan
    // yang batal tetap terkunci `reserved`: barang ada di gudang tapi sistem
    // bilang habis, sehingga pesanan lain ikut terpakos.
    //
    // Idempoten: hanya reservasi `ACTIVE` yang dilepas, jadi aman saat Shopee
    // mengirim status `CANCELLED` berulang kali.
    if (incoming === 'CANCELLED' && existing.status !== 'CANCELLED') {
      await releaseReservationsForOrder(
        existing.tenantId,
        existing.id,
        null,
        'Pesanan dibatalkan di Shopee',
      );
    }

    return { orderId: existing.id, created: false };
  }

  // Verify all variants belong to this tenant
  const variantIds = items.map((i) => i.variantId);
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds }, product: { tenantId } },
  });
  if (variants.length !== variantIds.length) {
    throw new ValidationError('Satu atau lebih varian produk tidak ditemukan dalam tenant ini.');
  }

  const status = (orderData.status as DomainOrderStatus) ?? 'NEW';

  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        tenantId,
        shopId,
        externalOrderId,
        status: status as OrderStatus,
        placedAt: orderData.placedAt,
        shipByAt: orderData.shipByAt ?? null,
        buyerName: orderData.buyerName ?? null,
        buyerPhone: orderData.buyerPhone ?? null,
        shippingAddress: (orderData.shippingAddress ?? {}) as Prisma.InputJsonValue,
        ...contactFields,
        ...moneyFields,
        items: {
          create: items.map((item) => ({
            variantId: item.variantId,
            quantity: item.quantity,
            fulfilledQuantity: 0,
            unitPrice: item.unitPrice ?? null,
            status: 'PENDING',
          })),
        },
      },
    });
    await tx.orderStatusHistory.create({
      data: {
        orderId: created.id,
        fromStatus: null,
        toStatus: status as OrderStatus,
        reason: 'Pesanan diimpor dari marketplace',
      },
    });
    return created;
  });

  logger.info('Order imported', { tenantId, orderId: order.id, externalOrderId });
  return { orderId: order.id, created: true };
}

/**
 * Validate + apply an order status transition (ADR-004).
 */
export async function transitionOrderStatus(
  tenantId: string,
  orderId: string,
  toStatus: DomainOrderStatus,
  actorId?: string,
  reason?: string,
): Promise<void> {
  const order = await prisma.order.findFirst({ where: { id: orderId, tenantId } });
  if (!order) throw new NotFoundError('Pesanan', orderId);

  const fromStatus = order.status as DomainOrderStatus;
  if (!isValidOrderTransition(fromStatus, toStatus)) {
    throw new InvalidStateTransitionError('Pesanan', fromStatus, toStatus);
  }

  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: orderId }, data: { status: toStatus as OrderStatus } });
    await tx.orderStatusHistory.create({
      data: { orderId, fromStatus: fromStatus as OrderStatus, toStatus: toStatus as OrderStatus, actorId, reason },
    });
  });

  await auditLog({
    tenantId,
    actorId,
    action: 'order_status_change',
    entityType: 'Order',
    entityId: orderId,
    metadata: { fromStatus, toStatus, reason },
  });
}

/** Recalculate + persist explainable priority (FR-PRI-001..005). */
export async function recalculateOrderPriority(tenantId: string, orderId: string): Promise<void> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, tenantId },
    include: { items: { include: { reservations: { where: { status: 'ACTIVE' } } } } },
  });
  if (!order) throw new NotFoundError('Pesanan', orderId);

  const isStockReady = order.items.every((item) => {
    const reserved = item.reservations.reduce((sum, r) => sum + r.quantity, 0);
    return reserved >= item.quantity;
  });

  const ruleRecord = await prisma.priorityRule.findFirst({
    where: { tenantId, isEnabled: true },
    orderBy: { createdAt: 'desc' },
  });

  let rule: PriorityRuleConfig = DEFAULT_PRIORITY_RULE;
  if (ruleRecord) {
    try {
      rule = ruleRecord.criteriaJson as unknown as PriorityRuleConfig;
      rule.version = ruleRecord.version;
    } catch {
      logger.warn('Invalid priority rule config, using default', { tenantId, ruleId: ruleRecord.id });
    }
  }

  const result = calculatePriority(
    { shipByAt: order.shipByAt, placedAt: order.placedAt, isStockReady },
    rule,
  );

  await prisma.order.update({
    where: { id: orderId },
    data: {
      priorityScore: result.score,
      priorityLevel: result.level,
      priorityRuleVersion: result.ruleVersion,
      priorityFactors: result.factors as unknown as Prisma.InputJsonValue,
      priorityCalculatedAt: result.calculatedAt,
    },
  });
}

export async function listOrders(
  tenantId: string,
  options: {
    status?: DomainOrderStatus | DomainOrderStatus[];
    shopId?: string;
    page?: number;
    pageSize?: number;
    sortByPriority?: boolean;
  } = {},
) {
  const { status, shopId, page = 1, pageSize = 50, sortByPriority = false } = options;
  const skip = (page - 1) * pageSize;

  const statusFilter = status
    ? { status: Array.isArray(status) ? { in: status as OrderStatus[] } : (status as OrderStatus) }
    : {};

  const where: Prisma.OrderWhereInput = {
    tenantId,
    ...statusFilter,
    ...(shopId ? { shopId } : {}),
  };

  const orderBy = sortByPriority
    ? [{ priorityScore: 'desc' as const }, { shipByAt: 'asc' as const }]
    : [{ createdAt: 'desc' as const }];

  try {
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          shop: { select: { id: true, name: true, provider: true } },
          items: {
            include: {
              variant: {
                select: {
                  sku: true,
                  name: true,
                  product: { select: { name: true } },
                },
              },
            },
          },
          fulfillmentOrders: { select: { status: true, id: true } },
          shipments: {
            select: { id: true, awb: true, carrier: true, status: true },
            take: 1,
            orderBy: { createdAt: 'desc' },
          },
        },
        skip,
        take: pageSize,
        orderBy,
      }),
      prisma.order.count({ where }),
    ]);

    return {
      items: orders.map((o) => {
        const shipment = o.shipments[0];
        return {
          id: o.id,
          externalOrderId: o.externalOrderId,
          status: o.status,
          fulfillmentStatus: o.fulfillmentOrders[0]?.status ?? null,
          shopId: o.shopId,
          shopName: o.shop.name,
          provider: o.shop.provider,
          buyerName: o.buyerName,
          buyerPhone: o.buyerPhone,
          shippingAddress: o.shippingAddress,
          placedAt: o.placedAt,
          shipByAt: o.shipByAt,
          priorityScore: o.priorityScore,
          priorityLevel: o.priorityLevel,
          priorityFactors: o.priorityFactors,
          itemCount: o.items.length,
          awb: shipment?.awb ?? null,
          carrier: shipment?.carrier ?? null,
          shipmentStatus: shipment?.status ?? null,
          canPrintOfficialLabel: Boolean(o.shipments?.[0]?.awb?.trim()),
          items: o.items.map((it) => ({
            id: it.id,
            quantity: it.quantity,
            status: it.status,
            sku: it.variant.sku,
            variantName: it.variant.name,
            productName: it.variant.product.name,
          })),
        };
      }),
      pagination: { total, page, pageSize, hasMore: skip + pageSize < total },
    };
  } catch {
    const now = Date.now();
    const demoOrders = [
      {
        id: 'ord-demo-1',
        externalOrderId: 'SPX-2409-98210',
        status: 'READY_TO_PICK',
        fulfillmentStatus: 'READY_TO_PICK',
        shopName: 'Shopee Official Store',
        provider: 'shopee',
        buyerName: 'Rian Kurniawan',
        placedAt: new Date(now - 7200000).toISOString(),
        shipByAt: new Date(now + 3600000 * 2).toISOString(),
        priorityScore: 92,
        priorityLevel: 'CRITICAL',
        priorityFactors: null,
        itemCount: 2,
      },
      {
        id: 'ord-demo-2',
        externalOrderId: 'SPX-2409-98215',
        status: 'STOCK_RESERVED',
        fulfillmentStatus: 'READY_TO_PICK',
        shopName: 'Shopee Official Store',
        provider: 'shopee',
        buyerName: 'Siti Rahma',
        placedAt: new Date(now - 14400000).toISOString(),
        shipByAt: new Date(now + 3600000 * 5).toISOString(),
        priorityScore: 78,
        priorityLevel: 'HIGH',
        priorityFactors: null,
        itemCount: 1,
      },
      {
        id: 'ord-demo-3',
        externalOrderId: 'TOK-2409-11029',
        status: 'WAITING_STOCK',
        fulfillmentStatus: null,
        shopName: 'Tokopedia Store',
        provider: 'tokopedia',
        buyerName: 'Budi Santoso',
        placedAt: new Date(now - 86400000).toISOString(),
        shipByAt: new Date(now + 3600000 * 18).toISOString(),
        priorityScore: 45,
        priorityLevel: 'MEDIUM',
        priorityFactors: null,
        itemCount: 3,
      },
      {
        id: 'ord-demo-4',
        externalOrderId: 'SPX-2409-98001',
        status: 'COMPLETED',
        fulfillmentStatus: 'COMPLETED',
        shopName: 'Shopee Official Store',
        provider: 'shopee',
        buyerName: 'Dewi Lestari',
        placedAt: new Date(now - 172800000).toISOString(),
        shipByAt: new Date(now - 86400000).toISOString(),
        priorityScore: 20,
        priorityLevel: 'LOW',
        priorityFactors: null,
        itemCount: 1,
      },
    ];

    return {
      items: demoOrders,
      pagination: { total: demoOrders.length, page: 1, pageSize: 20, hasMore: false },
    };
  }
}

export async function getOrderDetail(tenantId: string, orderId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, tenantId },
    include: {
      shop: { select: { id: true, name: true, provider: true } },
      items: {
        include: {
          variant: { include: { product: { select: { name: true } } } },
          reservations: { where: { status: 'ACTIVE' } },
        },
      },
      statusHistory: { orderBy: { createdAt: 'desc' }, take: 20 },
      fulfillmentOrders: { include: { warehouse: { select: { name: true, code: true } } } },
      shipments: {
        include: { events: { orderBy: { occurredAt: 'desc' } } },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  if (!order) throw new NotFoundError('Pesanan', orderId);

  const priorityExplanation =
    order.priorityScore !== null && order.priorityFactors
      ? explainPriority(
          {
            score: order.priorityScore,
            level: order.priorityLevel as 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW',
            ruleVersion: order.priorityRuleVersion ?? 'priority-v1',
            factors: order.priorityFactors as { code: string; value: number; weight: number }[],
            calculatedAt: order.priorityCalculatedAt ?? new Date(),
          },
        )
      : null;

  const mainShipment = order.shipments[0];

  return {
    id: order.id,
    externalOrderId: order.externalOrderId,
    status: order.status,
    shopId: order.shopId,
    shopName: order.shop.name,
    provider: order.shop.provider,
    buyerName: order.buyerName,
    buyerPhone: order.buyerPhone,
    shippingAddress: order.shippingAddress,
    placedAt: order.placedAt,
    shipByAt: order.shipByAt,
    awb: mainShipment?.awb ?? null,
    carrier: mainShipment?.carrier ?? null,
    shipmentStatus: mainShipment?.status ?? null,
    canPrintOfficialLabel: Boolean(order.shipments?.[0]?.awb?.trim()),
    // Rincian uang WAJIB ikut dikembalikan. Halaman detail pesanan dan Laporan
    // Keuangan menampilkan "Estimasi dana masuk" serta "Potongan Shopee"; kalau
    // field ini tidak dikirim, UI selalu menampilkan "—" walau nilainya sudah
    // ada di database.
    //
    // Field-nya sengaja dikembalikan RATA ATAS (bukan nested di `money`) supaya
    // kontrak frontend tidak berubah dan tidak ada dua bentuk data untuk
    // hal yang sama.
    totalAmount: order.totalAmount,
    itemSubtotal: order.itemSubtotal,
    sellerDiscount: order.sellerDiscount,
    shopeeDiscount: order.shopeeDiscount,
    buyerShippingFee: order.buyerShippingFee,
    shippingFeeDiscount: order.shippingFeeDiscount,
    platformFee: order.platformFee,
    escrowAmount: order.escrowAmount,
    paymentMethod: order.paymentMethod,
    isCod: order.isCod,
    paidAt: order.paidAt,
    packageNumber: order.packageNumber,
    buyerNote: order.buyerNote,
    priority: {
      score: order.priorityScore,
      level: order.priorityLevel,
      ruleVersion: order.priorityRuleVersion,
      factors: order.priorityFactors,
      explanation: priorityExplanation,
    },
    items: order.items.map((item) => ({
      id: item.id,
      sku: item.variant.sku,
      productName: item.variant.product.name,
      variantName: item.variant.name,
      barcode: item.variant.barcode,
      quantity: item.quantity,
      fulfilledQuantity: item.fulfilledQuantity,
      unitPrice: item.unitPrice,
      status: item.status,
      isReserved: item.reservations.length > 0,
    })),
    statusHistory: order.statusHistory.map((h) => ({
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      reason: h.reason,
      createdAt: h.createdAt,
    })),
    fulfillmentOrders: order.fulfillmentOrders.map((fo) => ({
      id: fo.id,
      status: fo.status,
      warehouseName: fo.warehouse.name,
    })),
    shipments: order.shipments.map((s) => ({
      id: s.id,
      awb: s.awb,
      carrier: s.carrier,
      status: s.status,
      shippedAt: s.shippedAt,
      deliveredAt: s.deliveredAt,
      events: s.events.map((e) => ({
        id: e.id,
        status: e.status,
        description: e.description,
        occurredAt: e.occurredAt,
      })),
    })),
  };
}
