import { z } from 'zod';
import { prisma } from '@/shared/infrastructure/prisma';
import type { ReturnStatus, InspectionResult } from '@prisma/client';
import {
  NotFoundError,
  ValidationError,
  InvalidStateTransitionError,
  BusinessRuleViolationError,
} from '@/shared/errors/AppError';
import { auditLog } from '@/modules/audit/application/auditLog.service';

// ────────────────────────────────────────────────────────────
// Return state machine
// ────────────────────────────────────────────────────────────

/**
 * State machine retur.
 *
 * `ARRIVED` sengaja ada: itu artinya paket retur **benar-benar sudah sampai di
 * gudang**, bukan sekadar status Shopee berubah. Retur belum tentu barangnya
 * sudah sampai — jadi stok tidak boleh bertambah sebelum tahap ini.
 *
 * Alur: Shopee bilang retur → IN_TRANSIT → paket datang (scan/konfirmasi) →
 * ARRIVED → operator terima → RECEIVED → inspeksi → RESTOCKED (stok naik di
 * sini, bukan di ARRIVED).
 */
const RETURN_TRANSITIONS: Record<ReturnStatus, ReturnStatus[]> = {
  REQUESTED: ['IN_TRANSIT', 'ARRIVED'],
  IN_TRANSIT: ['ARRIVED'],
  ARRIVED: ['RECEIVED'],
  RECEIVED: ['INSPECTION'],
  INSPECTION: ['RESTOCKED', 'DAMAGED', 'REJECTED', 'CLOSED'],
  RESTOCKED: ['CLOSED'],
  DAMAGED: ['CLOSED'],
  REJECTED: ['CLOSED'],
  CLOSED: [],
};

function isValidReturnTransition(from: ReturnStatus, to: ReturnStatus): boolean {
  return RETURN_TRANSITIONS[from]?.includes(to) ?? false;
}

// ────────────────────────────────────────────────────────────
// Input schemas
// ────────────────────────────────────────────────────────────

export const RegisterReturnSchema = z.object({
  orderId: z.string().min(1),
  externalReturnId: z.string().optional(),
  reason: z.string().max(500).optional(),
  items: z.array(
    z.object({
      variantId: z.string().min(1),
      quantity: z.number().int().positive(),
    }),
  ).min(1),
});

export const InspectReturnSchema = z.object({
  items: z.array(
    z.object({
      returnItemId: z.string().min(1),
      result: z.enum(['SELLABLE', 'DAMAGED', 'PARTIAL', 'REJECTED']),
      /**
       * Untuk `PARTIAL`: berapa unit yang benar-benar layak jual. Wajib diisi
       * untuk `PARTIAL` supaya tidak perlu menebak angka.
       */
      sellableQuantity: z.number().int().min(0).optional(),
      notes: z.string().max(500).optional(),
    }),
  ).min(1),
});

/**
 * Scan barang retur yang benar-benar sudah datang di gudang.
 *
 * Operator memindai per item (bisa bertahap: paket datang sebagian). Angka
 * `scannedQuantity` adalah fakta fisik — inilah satu-satunya sumber kebenaran
 * untuk menaikkan stok retur, bukan status Shopee.
 */
export const ScanReturnArrivalSchema = z.object({
  items: z
    .array(
      z.object({
        returnItemId: z.string().min(1),
        scannedQuantity: z.number().int().min(0, 'Jumlah hasil pindai tidak boleh negatif.'),
      }),
    )
    .min(1),
  notes: z.string().max(500).optional(),
});

// ────────────────────────────────────────────────────────────
// Use Cases
// ────────────────────────────────────────────────────────────

/**
 * Register a return request.
 * FR-RET-001, FR-RET-002
 */
export async function registerReturn(
  tenantId: string,
  input: z.infer<typeof RegisterReturnSchema>,
  actorId: string,
) {
  const parsed = RegisterReturnSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('Data pengembalian tidak valid.', {
      fields: parsed.error.flatten().fieldErrors,
    });
  }

  const order = await prisma.order.findFirst({
    where: { id: parsed.data.orderId, tenantId },
  });
  if (!order) throw new NotFoundError('Pesanan', parsed.data.orderId);

  // Idempotency for external return ID
  if (parsed.data.externalReturnId) {
    const existing = await prisma.return.findFirst({
      where: { orderId: order.id, externalReturnId: parsed.data.externalReturnId },
    });
    if (existing) return { returnId: existing.id, created: false };
  }

  const returnRecord = await prisma.return.create({
    data: {
      orderId: order.id,
      externalReturnId: parsed.data.externalReturnId,
      status: 'REQUESTED',
      reason: parsed.data.reason,
      items: {
        create: parsed.data.items.map((item) => ({
          variantId: item.variantId,
          quantity: item.quantity,
        })),
      },
    },
  });

  await auditLog({
    tenantId,
    actorId,
    action: 'return_registered',
    entityType: 'Return',
    entityId: returnRecord.id,
    metadata: { orderId: order.id, reason: parsed.data.reason },
  });

  return { returnId: returnRecord.id, created: true };
}

/**
 * Catat barang retur yang benar-benar sudah datang di gudang (hasil pindai).
 *
 * ATURAN PENTING
 * --------------
 * Fungsi ini TIDAK menambah stok. Stok naik hanya di `inspectReturn()` dan
 * hanya sejumlah unit yang tercatat di sini. Jadi barang yang belum nyampe
 * tidak akan pernah ikut menambah stok.
 *
 * Saat semua item sudah tercakup penuh, retur naik ke `ARRIVED` - inilah
 * penanda bahwa paketnya benar-benar lengkap di gudang.
 */
export async function scanReturnArrival(
  tenantId: string,
  returnId: string,
  input: z.infer<typeof ScanReturnArrivalSchema>,
  actorId: string,
): Promise<{
  returnId: string;
  status: ReturnStatus;
  scannedTotal: number;
  expectedTotal: number;
  fullyArrived: boolean;
  message: string;
}> {
  const parsed = ScanReturnArrivalSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('Data hasil pindai retur tidak valid.', {
      fields: parsed.error.flatten().fieldErrors,
    });
  }

  const returnRecord = await prisma.return.findFirst({
    where: { id: returnId, order: { tenantId } },
    include: { items: true },
  });
  if (!returnRecord) throw new NotFoundError('Pengembalian', returnId);

  if (returnRecord.status === 'CLOSED' || returnRecord.status === 'RESTOCKED') {
    throw new BusinessRuleViolationError(
      `Pengembalian ini sudah selesai diproses (status: ${returnRecord.status}).`,
    );
  }

  const expectedTotal = returnRecord.items.reduce((s, i) => s + i.quantity, 0);
  const touched: string[] = [];

  for (const entry of parsed.data.items) {
    const item = returnRecord.items.find((i) => i.id === entry.returnItemId);
    if (!item) throw new NotFoundError('Item pengembalian', entry.returnItemId);

    // Pindai tidak boleh melebihi jumlah yang Shopee bilang akan kembali.
    // Kalau melebihi, itu salah input - bukan bukti barang lebih banyak.
    if (entry.scannedQuantity > item.quantity) {
      throw new BusinessRuleViolationError(
        `Jumlah hasil pindai (${entry.scannedQuantity}) melebihi jumlah retur yang dijanjikan Shopee (${item.quantity}).`,
        { returnItemId: item.id, scanned: entry.scannedQuantity, promised: item.quantity },
      );
    }

    // Idempoten: pindai ulang dengan angka yang sama tidak mengetik apa pun,
    // jadi tidak ada risiko stok bertambah dua kali.
    if (entry.scannedQuantity === item.scannedQuantity) continue;

    await prisma.returnItem.update({
      where: { id: item.id },
      data: {
        scannedQuantity: entry.scannedQuantity,
        scannedAt: new Date(),
        notes: parsed.data.notes ?? item.notes,
      },
    });
    touched.push(item.id);
  }

  const refreshed = await prisma.returnItem.findMany({ where: { returnId } });
  const scannedTotal = refreshed.reduce((s, i) => s + i.scannedQuantity, 0);
  const fullyArrived = scannedTotal >= expectedTotal;

  // Retur baru ditandai "sampai" kalau seluruh isinya sudah tercatat.
  if (fullyArrived && returnRecord.status !== 'ARRIVED') {
    if (!isValidReturnTransition(returnRecord.status, 'ARRIVED')) {
      throw new InvalidStateTransitionError('Pengembalian', returnRecord.status, 'ARRIVED');
    }
    await prisma.return.update({
      where: { id: returnId },
      data: { status: 'ARRIVED', arrivedAt: new Date() },
    });
  }

  await auditLog({
    tenantId,
    actorId,
    action: 'return_arrival_scanned',
    entityType: 'Return',
    entityId: returnId,
    metadata: { scannedTotal, expectedTotal, fullyArrived, itemIds: touched },
  });

  return {
    returnId,
    status: fullyArrived ? 'ARRIVED' : returnRecord.status,
    scannedTotal,
    expectedTotal,
    fullyArrived,
    message: fullyArrived
      ? `Semua barang retur sudah tercatat datang (${scannedTotal} unit). Lanjut ke penerimaan & inspeksi.`
      : `Barang retur tercatat ${scannedTotal} dari ${expectedTotal} unit. Sisanya belum datang.`,
  };
}

/**
 * Mark return as received at warehouse.
 *
 * WAJIB lewat `ARRIVED` dulu: tanpa itu, operator bisa menekan "Terima"
 * padahal paketnya belum sampai, dan stok ikut bertambah terlalu awal.
 */
export async function receiveReturn(
  tenantId: string,
  returnId: string,
  actorId: string,
): Promise<void> {
  const returnRecord = await prisma.return.findFirst({
    where: { id: returnId, order: { tenantId } },
  });
  if (!returnRecord) throw new NotFoundError('Pengembalian', returnId);

  if (!isValidReturnTransition(returnRecord.status, 'RECEIVED')) {
    throw new InvalidStateTransitionError('Pengembalian', returnRecord.status, 'RECEIVED');
  }

  await prisma.return.update({
    where: { id: returnId },
    data: { status: 'RECEIVED', receivedAt: new Date() },
  });

  await auditLog({
    tenantId,
    actorId,
    action: 'return_received',
    entityType: 'Return',
    entityId: returnId,
  });
}

/**
 * Inspect return items and determine outcome.
 * FR-RET-003, FR-RET-004, FR-RET-005
 * 
 * SELLABLE → restock (inventory movement)
 * DAMAGED  → damaged stock (no sellable increase)
 * REJECTED → no restock
 */
export async function inspectReturn(
  tenantId: string,
  returnId: string,
  input: z.infer<typeof InspectReturnSchema>,
  actorId: string,
  warehouseId: string,
): Promise<void> {
  const parsed = InspectReturnSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('Data inspeksi tidak valid.', {
      fields: parsed.error.flatten().fieldErrors,
    });
  }

  const returnRecord = await prisma.return.findFirst({
    where: { id: returnId, order: { tenantId } },
    include: { items: true },
  });
  if (!returnRecord) throw new NotFoundError('Pengembalian', returnId);

  if (returnRecord.status !== 'RECEIVED' && returnRecord.status !== 'INSPECTION') {
    throw new BusinessRuleViolationError(
      `Pengembalian tidak dapat diinspeksi. Status saat ini: ${returnRecord.status}.`,
    );
  }

  // Determine final status
  const results = parsed.data.items;
  const hasSellable = results.some((r) => r.result === 'SELLABLE' || r.result === 'PARTIAL');
  const allDamaged = results.every((r) => r.result === 'DAMAGED');
  const finalStatus: ReturnStatus = allDamaged ? 'DAMAGED' : hasSellable ? 'RESTOCKED' : 'REJECTED';

  await prisma.$transaction(async (tx) => {
    // Update inspection results on each item
    for (const inspection of results) {
      const returnItem = returnRecord.items.find((i) => i.id === inspection.returnItemId);
      if (!returnItem) continue;

      await tx.returnItem.update({
        where: { id: inspection.returnItemId },
        data: {
          inspectionResult: inspection.result as InspectionResult,
          inspectedAt: new Date(),
          notes: inspection.notes,
        },
      });

      // Create inventory movement for sellable items only
      if (inspection.result === 'SELLABLE' || inspection.result === 'PARTIAL') {
        // Dasar perhitungan HANYA jumlah yang benar-benar tercatat sudah datang
        // (`scannedQuantity`). `returnItem.quantity` adalah angka janji Shopee,
        // bukan fakta di gudang - memakainya membuat stok bertambah untuk barang
        // yang belum tiba.
        //
        // `PARTIAL` tidak lagi memakai `Math.floor(quantity / 2)` karena angka
        // setengah tidak pernah berasal dari barang nyata; operator menulis
        // jumlahnya sendiri saat inspeksi.
        const availableToRestock = returnItem.scannedQuantity;
        const restockQty = inspection.sellableQuantity ?? availableToRestock;

        if (restockQty > availableToRestock) {
          throw new BusinessRuleViolationError(
            `Jumlah yang dinilai layak jual untuk item ${returnItem.variantId} (${restockQty}) melebihi ` +
              `jumlah barang yang benar-benar tercatat datang (${availableToRestock}).`,
            { returnItemId: returnItem.id, sellable: restockQty, arrived: availableToRestock },
          );
        }
        if (restockQty <= 0) {
          // Tidak ada barang yang benar-benar datang — tidak boleh ada stok baru.
          continue;
        }

        // Upsert inventory balance
        await tx.inventoryBalance.upsert({
          where: {
            warehouseId_variantId: {
              warehouseId,
              variantId: returnItem.variantId,
            },
          },
          create: {
            warehouseId,
            variantId: returnItem.variantId,
            onHand: restockQty,
            reserved: 0,
            blocked: 0,
            version: 1,
          },
          update: {
            onHand: { increment: restockQty },
            version: { increment: 1 },
          },
        });

        await tx.inventoryMovement.create({
          data: {
            tenantId,
            warehouseId,
            variantId: returnItem.variantId,
            movementType: 'RETURN_RESTOCK',
            quantityDelta: restockQty,
            referenceType: 'return',
            referenceId: returnId,
            reason: `Return QC: ${inspection.result}`,
            actorId,
          },
        });
      } else if (inspection.result === 'DAMAGED') {
        // Record as damaged — no sellable stock increase
        await tx.inventoryMovement.create({
          data: {
            tenantId,
            warehouseId,
            variantId: returnItem.variantId,
            movementType: 'RETURN_DAMAGED',
            quantityDelta: 0, // no stock change
            referenceType: 'return',
            referenceId: returnId,
            reason: 'Return QC: DAMAGED',
            actorId,
          },
        });
      }
    }

    // Update return status
    await tx.return.update({
      where: { id: returnId },
      data: { status: finalStatus },
    });
  });

  await auditLog({
    tenantId,
    actorId,
    action: 'return_inspected',
    entityType: 'Return',
    entityId: returnId,
    metadata: { finalStatus, itemCount: results.length },
  });
}

/**
 * List returns for tenant.
 */
export async function listReturns(
  tenantId: string,
  options: { status?: ReturnStatus; page?: number; pageSize?: number } = {},
) {
  const { status, page = 1, pageSize = 50 } = options;
  const skip = (page - 1) * pageSize;

  const where = {
    order: { tenantId },
    ...(status ? { status } : {}),
  };

  const [returns, total] = await Promise.all([
    prisma.return.findMany({
      where,
      include: {
        order: {
          select: {
            externalOrderId: true,
            shop: { select: { name: true } },
          },
        },
        items: {
          include: {
            variant: { select: { sku: true, name: true } },
          },
        },
      },
      skip,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.return.count({ where }),
  ]);

  return {
    items: returns.map((r) => ({
      id: r.id,
      externalReturnId: r.externalReturnId,
      status: r.status,
      reason: r.reason,
      receivedAt: r.receivedAt,
      // Waktu paket benar-benar tiba di gudang (bukan sekadar status Shopee).
      arrivedAt: r.arrivedAt,
      order: {
        externalOrderId: r.order.externalOrderId,
        shopName: r.order.shop.name,
      },
      items: r.items.map((i) => ({
        id: i.id,
        sku: i.variant.sku,
        variantName: i.variant.name,
        quantity: i.quantity,
        scannedQuantity: i.scannedQuantity,
        inspectionResult: i.inspectionResult,
      })),
    })),
    pagination: { total, page, pageSize, hasMore: skip + pageSize < total },
  };
}
