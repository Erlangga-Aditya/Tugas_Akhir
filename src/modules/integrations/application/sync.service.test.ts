import { describe, it, expect } from 'vitest';
import {
  mapShopeeStatusToInternal,
  mapReturnStatus,
  mapLogisticsStatus,
} from './sync.service';

describe('Sync Service Status Mappings', () => {
  describe('mapShopeeStatusToInternal', () => {
    it('maps unpaid, pending, in_cancel, to_return to NEW', () => {
      expect(mapShopeeStatusToInternal('UNPAID')).toBe('NEW');
      expect(mapShopeeStatusToInternal('PENDING')).toBe('NEW');
      expect(mapShopeeStatusToInternal('IN_CANCEL')).toBe('NEW');
      expect(mapShopeeStatusToInternal('TO_RETURN')).toBe('NEW');
    });

    it('maps actionable fulfillment statuses to CONFIRMED', () => {
      expect(mapShopeeStatusToInternal('READY_TO_SHIP')).toBe('CONFIRMED');
      expect(mapShopeeStatusToInternal('PROCESSED')).toBe('CONFIRMED');
      expect(mapShopeeStatusToInternal('RETRY_SHIP')).toBe('CONFIRMED');
      expect(mapShopeeStatusToInternal('SHIPPED')).toBe('CONFIRMED');
      expect(mapShopeeStatusToInternal('TO_CONFIRM_RECEIVE')).toBe('CONFIRMED');
    });

    it('maps terminal statuses to CANCELLED and COMPLETED', () => {
      expect(mapShopeeStatusToInternal('CANCELLED')).toBe('CANCELLED');
      expect(mapShopeeStatusToInternal('COMPLETED')).toBe('COMPLETED');
    });

    it('defaults unknown status to NEW', () => {
      expect(mapShopeeStatusToInternal('SOME_UNKNOWN_STATUS')).toBe('NEW');
    });
  });

  describe('mapReturnStatus', () => {
    it('maps requested/processing to REQUESTED', () => {
      expect(mapReturnStatus('REQUESTED')).toBe('REQUESTED');
      expect(mapReturnStatus('PROCESSING')).toBe('REQUESTED');
    });

    it('maps accepted to IN_TRANSIT', () => {
      expect(mapReturnStatus('ACCEPTED')).toBe('IN_TRANSIT');
    });

    it('maps received/to_receive to RECEIVED', () => {
      expect(mapReturnStatus('RECEIVED')).toBe('RECEIVED');
      expect(mapReturnStatus('TO_RECEIVE')).toBe('RECEIVED');
    });

    it('maps completed to CLOSED and rejected to REJECTED', () => {
      expect(mapReturnStatus('COMPLETED')).toBe('CLOSED');
      expect(mapReturnStatus('REJECTED')).toBe('REJECTED');
    });

    it('defaults unknown status to REQUESTED', () => {
      expect(mapReturnStatus('UNKNOWN')).toBe('REQUESTED');
    });
  });

  describe('mapLogisticsStatus', () => {
    it('maps pre-shipment statuses', () => {
      expect(mapLogisticsStatus('LOGISTICS_NOT_START')).toBe('PENDING');
      expect(mapLogisticsStatus('LOGISTICS_PENDING_ARRANGE')).toBe('PENDING');
      expect(mapLogisticsStatus('READY_TO_SHIP')).toBe('READY_TO_SHIP');
      expect(mapLogisticsStatus('LOGISTICS_READY')).toBe('READY_TO_SHIP');
    });

    it('maps pre-pickup statuses to READY_TO_SHIP (belum diambil kurir)', () => {
      // Penting: `LOGISTICS_REQUEST_CREATED` berarti permintaan dibuat, paket
      // belum diambil oleh kurir — bukan "sudah diambil".
      expect(mapLogisticsStatus('LOGISTICS_REQUEST_CREATED')).toBe('READY_TO_SHIP');
      expect(mapLogisticsStatus('PROCESSED')).toBe('READY_TO_SHIP');
      expect(mapLogisticsStatus('LOGISTICS_PICKUP_RETRY')).toBe('READY_TO_SHIP');
      expect(mapLogisticsStatus('LOGISTICS_PICKUP_DONE')).toBe('PICKED_UP');
    });

    it('maps in-transit statuses', () => {
      expect(mapLogisticsStatus('SHIPPED')).toBe('IN_TRANSIT');
      expect(mapLogisticsStatus('TO_CONFIRM_RECEIVE')).toBe('IN_TRANSIT');
    });

    it('maps terminal delivery statuses', () => {
      expect(mapLogisticsStatus('LOGISTICS_DELIVERY_DONE')).toBe('DELIVERED');
      expect(mapLogisticsStatus('COMPLETED')).toBe('DELIVERED');
      expect(mapLogisticsStatus('LOGISTICS_DELIVERY_FAILED')).toBe('FAILED');
      expect(mapLogisticsStatus('CANCELLED')).toBe('FAILED');
      expect(mapLogisticsStatus('TO_RETURN')).toBe('RETURNED');
      expect(mapLogisticsStatus('RETURNED')).toBe('RETURNED');
    });
  });
});
