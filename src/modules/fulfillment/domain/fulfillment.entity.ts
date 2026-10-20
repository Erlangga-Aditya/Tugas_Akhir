/**
 * Fulfillment Domain — State Machine
 *
 * ADR-004: Explicit state machines.
 * FulfillmentOrder states are separate from Order states.
 * WAITING_STOCK = stock insufficient; moves to READY_TO_PICK when stock arrives.
 */

export type FulfillmentStatus =
  | 'WAITING_STOCK'
  | 'READY_TO_PICK'
  | 'PICKING'
  | 'PICKED'
  | 'PACKING'
  | 'PACKED'
  | 'READY_TO_SHIP'
  | 'HANDED_OVER'
  | 'COMPLETED'
  | 'EXCEPTION';

const FULFILLMENT_TRANSITIONS: Record<FulfillmentStatus, FulfillmentStatus[]> = {
  WAITING_STOCK: ['READY_TO_PICK', 'EXCEPTION'],
  READY_TO_PICK: ['PICKING', 'EXCEPTION'],
  PICKING: ['PICKED', 'EXCEPTION'],
  PICKED: ['PACKING', 'PACKED', 'EXCEPTION'],
  PACKING: ['PACKED', 'EXCEPTION'],
  PACKED: ['READY_TO_SHIP', 'EXCEPTION'],
  READY_TO_SHIP: ['HANDED_OVER', 'EXCEPTION'],
  HANDED_OVER: ['COMPLETED', 'EXCEPTION'],
  COMPLETED: [],
  // Pesanan dibatalkan bisa kembali ke antrean kalau dibuka ulang.
  EXCEPTION: ['WAITING_STOCK', 'READY_TO_PICK', 'PICKING', 'PACKING'],
};

export function isValidFulfillmentTransition(
  from: FulfillmentStatus,
  to: FulfillmentStatus,
): boolean {
  return FULFILLMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface ScannedItem {
  pickingItemId: string;
  sku: string;
  variantName: string;
  expectedQuantity: number;
  pickedQuantity: number;
  isConfirmed: boolean;
}

export type ScanError =
  | { code: 'SKU_NOT_FOUND'; message: string }
  | { code: 'SKU_MISMATCH'; message: string; expectedSku: string }
  | { code: 'QUANTITY_EXCEEDED'; message: string; max: number }
  | { code: 'ALREADY_CONFIRMED'; message: string };
