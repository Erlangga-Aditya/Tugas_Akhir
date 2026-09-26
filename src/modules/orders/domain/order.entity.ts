/**
 * Order Domain — State Machine + Business Rules
 *
 * ADR-004: explicit state machines. The Order lifecycle is intentionally NARROW.
 * The warehouse pipeline (pick → pack → ship) lives on FulfillmentOrder.status.
 * Mapping from Shopee order_status lives in the integration adapter (ADR-002:
 * internal model is independent of marketplace schemas).
 */

export type OrderStatus = 'NEW' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';

const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  NEW: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['COMPLETED', 'CANCELLED'],
  CANCELLED: [],
  COMPLETED: [],
};

export function isValidOrderTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertOrderTransition(from: OrderStatus, to: OrderStatus): void {
  if (!isValidOrderTransition(from, to)) {
    throw new Error(
      `Transisi status pesanan tidak valid: ${from} → ${to}. ` +
        `Status yang diperbolehkan: ${ORDER_TRANSITIONS[from]?.join(', ') ?? 'tidak ada'}.`,
    );
  }
}

export type PriorityLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface PriorityFactor {
  code: string;
  value: number; // 0-1
  weight: number; // 0-1
}

export interface PriorityResult {
  score: number; // 0-100
  level: PriorityLevel;
  ruleVersion: string;
  factors: PriorityFactor[];
  calculatedAt: Date;
}
