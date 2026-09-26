import { Prisma } from '@prisma/client';

/**
 * FIFO (First In, First Out) untuk stok fisik gudang.
 *
 * Kenapa ini penting: angka stok di Shopee diisi manual oleh seller dan sering
 * tidak mencerminkan barang fisik. Karena itu sistem ini memakai stok sendiri
 * (`inventory_balances.on_hand`) sebagai kebenaran, dan setiap barang masuk
 * dicatat sebagai LOT. Saat barang keluar, lot yang paling lama disimpan (receivedAt
 * paling awal) dikonsumsi lebih dulu — inilah FIFO yang sebenarnya.
 */

export interface LotInput {
  warehouseId: string;
  variantId: string;
  quantity: number;
  /** RECEIVE | ADJUSTMENT | RETURN | OPENING */
  source?: string;
  referenceId?: string | null;
  notes?: string | null;
  receivedAt?: Date;
}

export interface LotConsumption {
  lotId: string;
  quantity: number;
  receivedAt: Date;
  source: string;
}

type TxClient = Prisma.TransactionClient;

/** Catat lot baru setiap kali stok fisik masuk. */
export async function createStockLot(tx: TxClient, input: LotInput) {
  return tx.stockLot.create({
    data: {
      warehouseId: input.warehouseId,
      variantId: input.variantId,
      quantity: input.quantity,
      remaining: input.quantity,
      source: input.source ?? 'RECEIVE',
      referenceId: input.referenceId ?? null,
      notes: input.notes ?? null,
      ...(input.receivedAt ? { receivedAt: input.receivedAt } : {}),
    },
  });
}

/**
 * Konsumsi stok secara FIFO: lot terlama dikurangi lebih dulu.
 *
 * Kalau stok fisik ternyata tidak punya lot (mis. saldo yang sudah ada sebelum
 * pencatatan lot diaktifkan), otomatis dibuat lot `OPENING` yang langsung habis
 * terpakai — supaya total `remaining` tidak pernah menyimpang jauh dari `on_hand`.
 */
export async function consumeStockLotsFifo(
  tx: TxClient,
  input: { warehouseId: string; variantId: string; quantity: number; referenceId?: string | null },
): Promise<LotConsumption[]> {
  if (input.quantity <= 0) return [];

  const lots = await tx.stockLot.findMany({
    where: { warehouseId: input.warehouseId, variantId: input.variantId, remaining: { gt: 0 } },
    orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }],
  });

  let remainingToConsume = input.quantity;
  const consumed: LotConsumption[] = [];

  for (const lot of lots) {
    if (remainingToConsume <= 0) break;
    const take = Math.min(lot.remaining, remainingToConsume);
    await tx.stockLot.update({ where: { id: lot.id }, data: { remaining: { decrement: take } } });
    consumed.push({ lotId: lot.id, quantity: take, receivedAt: lot.receivedAt, source: lot.source });
    remainingToConsume -= take;
  }

  if (remainingToConsume > 0) {
    const opening = await createStockLot(tx, {
      warehouseId: input.warehouseId,
      variantId: input.variantId,
      quantity: remainingToConsume,
      source: 'OPENING',
      referenceId: input.referenceId ?? null,
      notes: 'Saldo awal sebelum pencatatan lot FIFO aktif',
      receivedAt: new Date(0), // dianggap paling lama, supaya ikut keluar lebih dulu
    });
    await tx.stockLot.update({ where: { id: opening.id }, data: { remaining: 0 } });
    consumed.push({
      lotId: opening.id,
      quantity: remainingToConsume,
      receivedAt: opening.receivedAt,
      source: 'OPENING',
    });
  }

  return consumed;
}

/** Daftar lot yang masih punya sisa, urut FIFO — dipakai untuk tampilan "batch mana yang keluar dulu". */
export async function listOpenLots(
  tx: { stockLot: { findMany: (args: unknown) => Promise<Array<{ id: string; receivedAt: Date; remaining: number; quantity: number; source: string }>> } },
  warehouseId: string,
  variantId: string,
) {
  return tx.stockLot.findMany({
    where: { warehouseId, variantId, remaining: { gt: 0 } },
    orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, receivedAt: true, remaining: true, quantity: true, source: true },
  });
}
