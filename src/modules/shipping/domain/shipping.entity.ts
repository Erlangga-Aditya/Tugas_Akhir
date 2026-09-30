import type { ShipmentStatus } from '@prisma/client';

export type { ShipmentStatus };

const SHIPMENT_TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  PENDING: ['READY_TO_SHIP'],
  READY_TO_SHIP: ['PICKED_UP', 'FAILED'],
  PICKED_UP: ['IN_TRANSIT', 'FAILED'],
  IN_TRANSIT: ['DELIVERED', 'FAILED', 'RETURNED'],
  DELIVERED: [],
  FAILED: ['READY_TO_SHIP', 'RETURNED'],
  RETURNED: [],
};

export function isValidShipmentTransition(
  from: ShipmentStatus,
  to: ShipmentStatus,
): boolean {
  return SHIPMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Map a Shopee logistics_status / tracking status to the internal ShipmentStatus.
 * Neutral mapping lives here (pure domain), provider specifics stay in the adapter.
 */
export function mapLogisticsToShipmentStatus(logisticsStatus: string): ShipmentStatus {
  switch (logisticsStatus) {
    case 'LOGISTICS_NOT_START':
    case 'LOGISTICS_PENDING_ARRANGE':
    case 'LOGISTICS_READY':
    case 'LOGISTICS_REQUEST_CREATED':
      return 'PENDING';
    case 'LOGISTICS_PICKUP_DONE':
      return 'PICKED_UP';
    case 'LOGISTICS_DELIVERY_DONE':
      return 'DELIVERED';
    case 'LOGISTICS_INVALID':
    case 'LOGISTICS_REQUEST_CANCELED':
    case 'LOGISTICS_PICKUP_FAILED':
    case 'LOGISTICS_PICKUP_RETRY':
    case 'LOGISTICS_DELIVERY_FAILED':
    case 'LOGISTICS_LOST':
      return 'FAILED';
    default:
      return 'IN_TRANSIT';
  }
}
