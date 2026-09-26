import { describe, it, expect } from 'vitest';
import { ScanReturnArrivalSchema, InspectReturnSchema } from './return.usecase';

/**
 * Regresi untuk: "stok bertambah ketika status retur berubah, padahal barangnya
 * belum nyampe semua".
 *
 * Kontrak baru:
 *  1. `arrival` mencatat JUMLAH FISIK yang benar-benar datang per item.
 *  2. Stok naik hanya dari `scannedQuantity`, bukan dari `quantity` janji Shopee.
 *  3. Pindai tidak boleh melebihi janji Shopee.
 *  4. `PARTIAL` wajib menyebut jumlah layak jual — tidak boleh menebak angka.
 */
describe('Kontrak scan barang retur', () => {
  describe('ScanReturnArrivalSchema', () => {
    it('menerima jumlah hasil pindai per item', () => {
      const parsed = ScanReturnArrivalSchema.safeParse({
        items: [{ returnItemId: 'ri-1', scannedQuantity: 2 }],
      });

      expect(parsed.success).toBe(true);
    });

    it('menerima pindai bertahap (barang datang sebagian)', () => {
      // Ini inti kebutuhan: retur belum tentu semua barangnya sudah sampai.
      const parsed = ScanReturnArrivalSchema.safeParse({
        items: [{ returnItemId: 'ri-1', scannedQuantity: 0 }],
        notes: 'Paket baru 1 dari 2, sisanya menyusul',
      });

      expect(parsed.success).toBe(true);
    });

    it('MENOLAK jumlah negatif', () => {
      expect(
        ScanReturnArrivalSchema.safeParse({
          items: [{ returnItemId: 'ri-1', scannedQuantity: -1 }],
        }).success,
      ).toBe(false);
    });

    it('MENOLAK nilai desimal', () => {
      expect(
        ScanReturnArrivalSchema.safeParse({
          items: [{ returnItemId: 'ri-1', scannedQuantity: 1.5 }],
        }).success,
      ).toBe(false);
    });

    it('MENOLAK daftar item kosong', () => {
      expect(ScanReturnArrivalSchema.safeParse({ items: [] }).success).toBe(false);
    });
  });

  describe('InspectReturnSchema', () => {
    it('menerima PARTIAL dengan jumlah layak jual yang eksplisit', () => {
      const parsed = InspectReturnSchema.safeParse({
        items: [{ returnItemId: 'ri-1', result: 'PARTIAL', sellableQuantity: 1 }],
      });

      expect(parsed.success).toBe(true);
    });

    it('menerima SELLABLE tanpa jumlah (semua yang datang layak jual)', () => {
      expect(
        InspectReturnSchema.safeParse({ items: [{ returnItemId: 'ri-1', result: 'SELLABLE' }] })
          .success,
      ).toBe(true);
    });

    it('menerima DAMAGED tanpa jumlah layak jual', () => {
      expect(
        InspectReturnSchema.safeParse({ items: [{ returnItemId: 'ri-1', result: 'DAMAGED' }] })
          .success,
      ).toBe(true);
    });
  });
});
