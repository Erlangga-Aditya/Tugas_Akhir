import { describe, expect, it } from 'vitest';
import {
  isLateWatch,
  resolveCancelActor,
  resolveCancelCategory,
  resolveLateRisk,
} from './order-exceptions';

const JAM = 60 * 60 * 1000;
const now = new Date('2026-10-19T03:00:00.000Z'); // 10.00 WIB

describe('kategori pembatalan', () => {
  it('IN_CANCEL = pembatalan DIAJUKAN (belum final)', () => {
    expect(resolveCancelCategory({ externalStatus: 'IN_CANCEL', cancelBy: 'buyer' })).toBe('DIAJUKAN');
  });

  it('CANCELLED dibedakan menurut cancel_by (buyer/seller/system/Ops)', () => {
    expect(resolveCancelCategory({ externalStatus: 'CANCELLED', cancelBy: 'buyer' })).toBe('DIBATALKAN_PEMBELI');
    expect(resolveCancelCategory({ externalStatus: 'CANCELLED', cancelBy: 'seller' })).toBe('DIBATALKAN_PENJUAL');
    expect(resolveCancelCategory({ externalStatus: 'CANCELLED', cancelBy: 'system' })).toBe('DIBATALKAN_SISTEM');
    expect(resolveCancelCategory({ externalStatus: 'CANCELLED', cancelBy: 'Ops' })).toBe('DIBATALKAN_SISTEM');
  });

  it('status selain IN_CANCEL/CANCELLED tidak punya kategori pembatalan', () => {
    for (const status of ['READY_TO_SHIP', 'PROCESSED', 'SHIPPED', 'COMPLETED', null]) {
      expect(resolveCancelCategory({ externalStatus: status })).toBeNull();
    }
  });

  it('cancel_by tidak dikenal tidak diklaim sebagai sistem', () => {
    expect(resolveCancelActor(null)).toBe('unknown');
    expect(resolveCancelActor('kurir')).toBe('unknown');
    expect(resolveCancelActor('buyer')).toBe('buyer');
  });
});

describe('risiko keterlambatan', () => {
  it('hanya relevan untuk pesanan yang masih harus dikirim', () => {
    expect(resolveLateRisk({ externalStatus: 'SHIPPED', shipByAt: new Date(now.getTime() + JAM), now })).toBe(
      'TIDAK_RELEVAN',
    );
    expect(resolveLateRisk({ externalStatus: 'CANCELLED', shipByAt: null, now })).toBe('TIDAK_RELEVAN');
    expect(resolveLateRisk({ externalStatus: 'READY_TO_SHIP', shipByAt: null, now })).toBe('TIDAK_RELEVAN');
  });

  it('tenggat sudah lewat = Terlambat', () => {
    expect(resolveLateRisk({ externalStatus: 'READY_TO_SHIP', shipByAt: new Date(now.getTime() - JAM), now })).toBe(
      'TERLAMBAT',
    );
  });

  it('READY_TO_SHIP dengan tenggat ≤24 jam = Besok Batal', () => {
    // Kasus nyata: 2610096XX8GEUY — "Besok Batal", belum ada resi.
    expect(resolveLateRisk({ externalStatus: 'READY_TO_SHIP', shipByAt: new Date(now.getTime() + 20 * JAM), now })).toBe(
      'BESOK_BATAL',
    );
  });

  it('PROCESSED dengan tenggat ≤24 jam = Beresiko Terlambat (sudah ada resi)', () => {
    // Kasus nyata: 261013FRW9T8NC — "Beresiko Terlambat", resi sudah terbit.
    expect(resolveLateRisk({ externalStatus: 'PROCESSED', shipByAt: new Date(now.getTime() + 20 * JAM), now })).toBe(
      'BERESIKO',
    );
  });

  it('tenggat 1-3 hari lagi = Beresiko, lebih dari 3 hari = Aman', () => {
    expect(resolveLateRisk({ externalStatus: 'PROCESSED', shipByAt: new Date(now.getTime() + 2 * 24 * JAM), now })).toBe(
      'BERESIKO',
    );
    expect(resolveLateRisk({ externalStatus: 'PROCESSED', shipByAt: new Date(now.getTime() + 5 * 24 * JAM), now })).toBe(
      'AMAN',
    );
  });

  it('penanda keterlambatan dipakai untuk kartu', () => {
    expect(isLateWatch('TERLAMBAT')).toBe(true);
    expect(isLateWatch('BESOK_BATAL')).toBe(true);
    expect(isLateWatch('BERESIKO')).toBe(true);
    expect(isLateWatch('AMAN')).toBe(false);
    expect(isLateWatch('TIDAK_RELEVAN')).toBe(false);
  });
});
