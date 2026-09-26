/**
 * Inventory Domain — Core Value Objects and Business Rules
 * 
 * Invariants (04-DOMAIN-MODEL.md, ADR-003):
 * - available = onHand - reserved - blocked
 * - All terms are non-negative unless explicit negative stock policy
 * - All changes go through movement records (immutable ledger)
 * - Reservations are atomic
 */

export interface InventoryBalance {
  id: string;
  warehouseId: string;
  variantId: string;
  onHand: number;
  reserved: number;
  blocked: number;
  version: number; // optimistic lock
}

export interface StockAvailability {
  warehouseId: string;
  variantId: string;
  onHand: number;
  reserved: number;
  blocked: number;
  available: number;
}

/**
 * Calculate available stock.
 * This is the single authoritative calculation.
 */
export function calculateAvailable(balance: {
  onHand: number;
  reserved: number;
  blocked: number;
}): number {
  return Math.max(0, balance.onHand - balance.reserved - balance.blocked);
}

/**
 * Check if sufficient stock is available for a quantity.
 */
export function hasSufficientStock(
  balance: { onHand: number; reserved: number; blocked: number },
  requiredQuantity: number,
  allowNegativeStock: boolean = false,
): boolean {
  if (allowNegativeStock) return true;
  return calculateAvailable(balance) >= requiredQuantity;
}

export type MovementType =
  | 'RECEIVE'
  | 'RESERVE'
  | 'RESERVE_RELEASE'
  | 'DEDUCTION'
  | 'ADJUSTMENT'
  | 'RETURN_RESTOCK'
  | 'RETURN_DAMAGED'
  | 'BLOCKED'
  | 'UNBLOCKED';

export type AdjustmentReason =
  | 'STOCK_COUNT'
  | 'DAMAGE'
  | 'EXPIRY'
  | 'THEFT'
  | 'TRANSFER'
  | 'RECEIVING_ERROR'
  | 'OTHER';
