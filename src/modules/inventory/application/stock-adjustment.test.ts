import { describe, it, expect } from 'vitest';
import { AdjustStockSchema, ADJUSTMENT_REASONS } from './inventory.usecase';

/**
 * Kontrak koreksi stok: operator mengetik "stok hasil hitung", bukan `+5`/`-3`.
 *
 * Ini mengunci dua hal yang pernah jadi sumber masalah:
 *  1. API menerima `countedOnHand` (angka absolut), bukan `quantityDelta`.
 *  2. `expectedOnHand` wajib ada sebagai pengaman versi — tanpa itu, dua
 *     operator yang hitung bersamaan bisa saling menimpa hasil hitung.
 */
describe('Kontrak koreksi stok (AdjustStockSchema)', () => {
  const base = {
    warehouseId: 'wh-1',
    variantId: 'var-1',
    expectedOnHand: 37,
    reason: 'STOCK_COUNT' as const,
  };

  it('menerima angka stok fisik hasil hitung', () => {
    const parsed = AdjustStockSchema.safeParse({ ...base, countedOnHand: 32 });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.countedOnHand).toBe(32);
  });

  it('menerima stok hasil hitung nol (barang habis di rak)', () => {
    const parsed = AdjustStockSchema.safeParse({ ...base, countedOnHand: 0 });

    expect(parsed.success).toBe(true);
  });

  it('MENOLAK stok hasil hitung negatif', () => {
    expect(AdjustStockSchema.safeParse({ ...base, countedOnHand: -1 }).success).toBe(false);
  });

  it('MENOLAK nilai desimal (stok harus bilangan bulat)', () => {
    expect(AdjustStockSchema.safeParse({ ...base, countedOnHand: 32.5 }).success).toBe(false);
  });

  it('MENOLAK kontrak lama berbasis quantityDelta', () => {
    // `quantityDelta` tidak lagi ada di skema. Kalau ada pemanggil lama,
    // validasi harus gagal loudly, bukan diam-diam memakai angka yang salah.
    const parsed = AdjustStockSchema.safeParse({ ...base, quantityDelta: -5 });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.flatten().fieldErrors).toHaveProperty('countedOnHand');
    }
  });

  it('MENOLAK permintaan tanpa expectedOnHand (versi tidak terkunci)', () => {
    const parsed = AdjustStockSchema.safeParse({
      warehouseId: 'wh-1',
      variantId: 'var-1',
      countedOnHand: 32,
      reason: 'STOCK_COUNT',
    });

    expect(parsed.success).toBe(false);
  });

  it('MENOLAK alasan yang tidak dikenal', () => {
    const parsed = AdjustStockSchema.safeParse({ ...base, countedOnHand: 30, reason: 'ALASAN_PALSU' });

    expect(parsed.success).toBe(false);
  });

  it('menerima seluruh alasan resmi', () => {
    for (const reason of ADJUSTMENT_REASONS) {
      expect(AdjustStockSchema.safeParse({ ...base, countedOnHand: 30, reason }).success).toBe(true);
    }
  });

  it('membolehkan catatan bebas, tetapi membatasi panjangnya', () => {
    expect(
      AdjustStockSchema.safeParse({ ...base, countedOnHand: 30, notes: 'Barang hilang saat kirim' }).success,
    ).toBe(true);
    expect(
      AdjustStockSchema.safeParse({ ...base, countedOnHand: 30, notes: 'x'.repeat(501) }).success,
    ).toBe(false);
  });
});
