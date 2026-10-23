import { describe, expect, it } from 'vitest';
import { ALASAN_TOLAK_SETUJUI, checkCancelApproval } from './cancellation';

const dasar = {
  role: 'OWNER' as const,
  externalStatus: 'IN_CANCEL',
  orderStatus: 'NEW',
  shipmentStatus: 'READY_TO_SHIP',
};

describe('persetujuan pembatalan pembeli', () => {
  it('OWNER boleh menyetujui pengajuan yang paketnya belum dijemput', () => {
    expect(checkCancelApproval(dasar)).toEqual({ ok: true });
  });

  it('STAFF tidak boleh, walau punya izin order.cancel', () => {
    const hasil = checkCancelApproval({ ...dasar, role: 'STAFF' });
    expect(hasil.ok).toBe(false);
    if (!hasil.ok) expect(hasil.reason).toBe('BUKAN_OWNER');
  });

  it('bukan pengajuan (mis. READY_TO_SHIP) ditolak dengan alasan jelas', () => {
    const hasil = checkCancelApproval({ ...dasar, externalStatus: 'READY_TO_SHIP' });
    expect(hasil.ok).toBe(false);
    if (!hasil.ok) {
      expect(hasil.reason).toBe('BUKAN_PENGAJUAN');
      expect(hasil.message).toBe(ALASAN_TOLAK_SETUJUI.BUKAN_PENGAJUAN);
    }
  });

  it('pesanan yang sudah final tidak bisa disetujui lagi', () => {
    for (const orderStatus of ['CANCELLED', 'COMPLETED']) {
      const hasil = checkCancelApproval({ ...dasar, orderStatus });
      expect(hasil.ok).toBe(false);
      if (!hasil.ok) expect(hasil.reason).toBe('SUDAH_FINAL');
    }
  });

  it('paket yang sudah dijemput/dalam perjalanan tidak bisa dibatalkan dari aplikasi', () => {
    for (const shipmentStatus of ['PICKED_UP', 'IN_TRANSIT', 'DELIVERED']) {
      const hasil = checkCancelApproval({ ...dasar, shipmentStatus });
      expect(hasil.ok).toBe(false);
      if (!hasil.ok) expect(hasil.reason).toBe('PAKET_SUDAH_JALAN');
    }
  });

  it('tanpa data pengiriman tetap boleh selama status IN_CANCEL', () => {
    expect(checkCancelApproval({ ...dasar, shipmentStatus: null })).toEqual({ ok: true });
  });

  it('status mentah tidak peka huruf besar/kecil', () => {
    expect(checkCancelApproval({ ...dasar, externalStatus: 'in_cancel' })).toEqual({ ok: true });
  });
});
