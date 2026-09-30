import { describe, it, expect } from 'vitest';
import { isValidShipmentTransition, mapLogisticsToShipmentStatus } from './shipping.entity';

describe('Shipping Domain — State Transitions', () => {
  it('allows valid progression: PENDING -> READY_TO_SHIP -> PICKED_UP -> IN_TRANSIT -> DELIVERED', () => {
    expect(isValidShipmentTransition('PENDING', 'READY_TO_SHIP')).toBe(true);
    expect(isValidShipmentTransition('READY_TO_SHIP', 'PICKED_UP')).toBe(true);
    expect(isValidShipmentTransition('PICKED_UP', 'IN_TRANSIT')).toBe(true);
    expect(isValidShipmentTransition('IN_TRANSIT', 'DELIVERED')).toBe(true);
  });
  it('allows transition to FAILED or RETURNED when in transit', () => {
    expect(isValidShipmentTransition('IN_TRANSIT', 'FAILED')).toBe(true);
    expect(isValidShipmentTransition('IN_TRANSIT', 'RETURNED')).toBe(true);
  });
  it('rejects invalid backwards transitions or jumping states', () => {
    expect(isValidShipmentTransition('PENDING', 'DELIVERED')).toBe(false);
    expect(isValidShipmentTransition('DELIVERED', 'READY_TO_SHIP')).toBe(false);
    expect(isValidShipmentTransition('READY_TO_SHIP', 'IN_TRANSIT')).toBe(false);
  });
});

describe('Shipping Domain — logistics status mapping', () => {
  it('maps LOGISTICS_PICKUP_DONE → PICKED_UP', () => {
    expect(mapLogisticsToShipmentStatus('LOGISTICS_PICKUP_DONE')).toBe('PICKED_UP');
  });
  it('maps LOGISTICS_DELIVERY_DONE → DELIVERED', () => {
    expect(mapLogisticsToShipmentStatus('LOGISTICS_DELIVERY_DONE')).toBe('DELIVERED');
  });
  it('maps LOGISTICS_LOST → FAILED', () => {
    expect(mapLogisticsToShipmentStatus('LOGISTICS_LOST')).toBe('FAILED');
  });
  it('maps unknown → IN_TRANSIT', () => {
    expect(mapLogisticsToShipmentStatus('SOMETHING_ELSE')).toBe('IN_TRANSIT');
  });
});
