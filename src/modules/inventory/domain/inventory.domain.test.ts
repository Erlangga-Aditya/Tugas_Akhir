import { describe, it, expect } from 'vitest';
import { calculateAvailable, hasSufficientStock } from '@/modules/inventory/domain/inventory.entity';
import { isValidOrderTransition } from '@/modules/orders/domain/order.entity';
import { isValidFulfillmentTransition } from '@/modules/fulfillment/domain/fulfillment.entity';

describe('Inventory Domain', () => {
  describe('calculateAvailable', () => {
    it('should return onHand - reserved - blocked', () => {
      expect(calculateAvailable({ onHand: 100, reserved: 20, blocked: 5 })).toBe(75);
    });
    it('should return 0 when result would be negative', () => {
      expect(calculateAvailable({ onHand: 10, reserved: 15, blocked: 0 })).toBe(0);
    });
    it('should return 0 for empty stock', () => {
      expect(calculateAvailable({ onHand: 0, reserved: 0, blocked: 0 })).toBe(0);
    });
    it('should handle exact availability', () => {
      expect(calculateAvailable({ onHand: 50, reserved: 50, blocked: 0 })).toBe(0);
    });
    it('formula: available = onHand - reserved - blocked', () => {
      const onHand = 200, reserved = 80, blocked = 10;
      expect(calculateAvailable({ onHand, reserved, blocked })).toBe(onHand - reserved - blocked);
    });
  });

  describe('hasSufficientStock', () => {
    it('should return true when available >= requested', () => {
      expect(hasSufficientStock({ onHand: 10, reserved: 2, blocked: 0 }, 5)).toBe(true);
    });
    it('should return false when available < requested', () => {
      expect(hasSufficientStock({ onHand: 5, reserved: 3, blocked: 0 }, 4)).toBe(false);
    });
    it('should return true when allowNegativeStock is enabled', () => {
      expect(hasSufficientStock({ onHand: 0, reserved: 0, blocked: 0 }, 100, true)).toBe(true);
    });
    it('should return true for exact match', () => {
      expect(hasSufficientStock({ onHand: 5, reserved: 0, blocked: 0 }, 5)).toBe(true);
    });
  });
});

describe('Order State Machine (narrow 4-value)', () => {
  it('NEW → CONFIRMED', () => expect(isValidOrderTransition('NEW', 'CONFIRMED')).toBe(true));
  it('NEW → CANCELLED', () => expect(isValidOrderTransition('NEW', 'CANCELLED')).toBe(true));
  it('rejects NEW → COMPLETED', () => expect(isValidOrderTransition('NEW', 'COMPLETED')).toBe(false));
  it('CONFIRMED → COMPLETED', () => expect(isValidOrderTransition('CONFIRMED', 'COMPLETED')).toBe(true));
  it('CONFIRMED → CANCELLED', () => expect(isValidOrderTransition('CONFIRMED', 'CANCELLED')).toBe(true));
  it('COMPLETED is terminal', () => expect(isValidOrderTransition('COMPLETED', 'NEW')).toBe(false));
  it('CANCELLED is terminal', () => expect(isValidOrderTransition('CANCELLED', 'CONFIRMED')).toBe(false));
});

describe('Fulfillment State Machine (warehouse pipeline)', () => {
  it('full happy path', () => {
    const path: Array<[string, string]> = [
      ['WAITING_STOCK', 'READY_TO_PICK'],
      ['READY_TO_PICK', 'PICKING'],
      ['PICKING', 'PICKED'],
      ['PICKED', 'PACKING'],
      ['PACKING', 'PACKED'],
      ['PACKED', 'READY_TO_SHIP'],
      ['READY_TO_SHIP', 'HANDED_OVER'],
      ['HANDED_OVER', 'COMPLETED'],
    ];
    for (const [from, to] of path) {
      expect(isValidFulfillmentTransition(from as never, to as never), `${from} → ${to}`).toBe(true);
    }
  });
  it('PICKING → EXCEPTION', () => expect(isValidFulfillmentTransition('PICKING', 'EXCEPTION')).toBe(true));
  it('rejects backwards PICKED → READY_TO_PICK', () =>
    expect(isValidFulfillmentTransition('PICKED', 'READY_TO_PICK')).toBe(false));
  it('rejects PICKING → PACKED (skip)', () =>
    expect(isValidFulfillmentTransition('PICKING', 'PACKED')).toBe(false));
});
