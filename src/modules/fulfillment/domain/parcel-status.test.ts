import { describe, expect, it } from 'vitest';
import { needsReconcile, parcelAlreadyLeft, resolveParcelPhase } from './parcel-status';

describe('fase paket', () => {
  it.each([
    ['PENDING', 'MENUNGGU_KURIR'],
    ['READY_TO_SHIP', 'MENUNGGU_KURIR'],
    ['PICKED_UP', 'DALAM_PERJALANAN'],
    ['IN_TRANSIT', 'DALAM_PERJALANAN'],
    ['DELIVERED', 'DITERIMA'],
    ['FAILED', 'GAGAL'],
    ['RETURNED', 'DIKEMBALIKAN'],
    [null, 'BELUM_DIKIRIM'],
    [undefined, 'BELUM_DIKIRIM'],
    ['STATUS_ASING', 'BELUM_DIKIRIM'],
  ])('status kirim %s → fase %s', (status, fase) => {
    expect(resolveParcelPhase(status as string | null | undefined)).toBe(fase);
  });

  it('paket yang sudah dijemput kurir dianggap SUDAH keluar gudang', () => {
    // Inilah inti perbaikan: sebelum ada modul ini, `PICKED_UP` tidak dianggap
    // "sudah jalan", sehingga scan resinya masuk jalur packing dan menagih stok.
    expect(parcelAlreadyLeft(resolveParcelPhase('PICKED_UP'))).toBe(true);
    expect(parcelAlreadyLeft(resolveParcelPhase('IN_TRANSIT'))).toBe(true);
  });

  it('paket yang masih menunggu kurir BELUM keluar — boleh dipacking', () => {
    expect(parcelAlreadyLeft(resolveParcelPhase('READY_TO_SHIP'))).toBe(false);
    expect(parcelAlreadyLeft(resolveParcelPhase(null))).toBe(false);
  });

  it('penutupan catatan fulfillment dituntut untuk semua paket yang sudah jalan', () => {
    expect(needsReconcile(resolveParcelPhase('IN_TRANSIT'))).toBe(true);
    expect(needsReconcile(resolveParcelPhase('DELIVERED'))).toBe(true);
    expect(needsReconcile(resolveParcelPhase('FAILED'))).toBe(true);
    expect(needsReconcile(resolveParcelPhase('RETURNED'))).toBe(true);
    expect(needsReconcile(resolveParcelPhase('READY_TO_SHIP'))).toBe(false);
  });
});
