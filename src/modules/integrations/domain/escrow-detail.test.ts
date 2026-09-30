import { describe, it, expect } from 'vitest';
import { describeShape, extractEscrowList, extractIncome } from './escrow-detail';

/**
 * Regresi untuk bug "Estimasi dana masuk & Potongan Shopee tidak pernah muncul".
 *
 * Bentuk respons di bawah diambil dari log produksi sungguhan, bukan tebakan:
 * kunci respons yang diterima adalah `0, 1, 2, … 10`, artinya Shopee mengirim
 * array langsung di dalam `response`, bukan objek dengan `order_income_list`.
 * Kode lama hanya mencoba kunci objek, sehingga data selalu terbaca kosong.
 */
describe('pembaca respons escrow Shopee', () => {
  describe('extractEscrowList', () => {
    it('membaca array langsung (bentuk yang benar-benar dikirim Shopee)', () => {
      const res = [
        { order_sn: '2609251DP1HPAW', order_income: { escrow_amount: 12345, commission_fee: 1000 } },
        { order_sn: '2609251ENME9EF', order_income: { escrow_amount: 6789, service_fee: 500 } },
      ];

      const list = extractEscrowList(res);

      expect(list).toHaveLength(2);
      expect(list[0]!.order_sn).toBe('2609251DP1HPAW');
    });

    it('membaca objek yang membungkus daftar di dalam kunci respons', () => {
      const res = { order_income_list: [{ order_sn: 'A1', order_income: { escrow_amount: 1 } }] };

      expect(extractEscrowList(res)).toHaveLength(1);
    });

    it('membaca objek yang hanya berisi kunci indeks (gejala log produksi)', () => {
      // Bentuk yang menghasilkan kunci "0, 1, 2, ..." pada Object.keys().
      const rows = [
        { order_sn: 'A1', order_income: { escrow_amount: 10 } },
        { order_sn: 'A2', order_income: { escrow_amount: 20 } },
      ];
      const asIndexedObject = Object.fromEntries(rows.map((r, i) => [String(i), r]));

      const list = extractEscrowList(asIndexedObject);

      expect(list).toHaveLength(2);
    });

    it('membaca satu pesanan tanpa pembungkus list', () => {
      const res = { order_sn: 'A1', escrow_amount: 999, commission_fee: 10 };

      expect(extractEscrowList(res)).toHaveLength(1);
    });

    it('mengembalikan array kosong untuk respons tidak dikenal', () => {
      expect(extractEscrowList(null)).toEqual([]);
      expect(extractEscrowList('bukan json')).toEqual([]);
      expect(extractEscrowList({})).toEqual([]);
    });
  });

  describe('extractIncome', () => {
    it('membaca rincian dari kunci yang Shopee pakai', () => {
      expect(extractIncome({ order_income: { escrow_amount: 1 } })).toEqual({ escrow_amount: 1 });
      expect(extractIncome({ escrow: { escrow_amount: 2 } })).toEqual({ escrow_amount: 2 });
      expect(extractIncome({ income: { escrow_amount: 3 } })).toEqual({ escrow_amount: 3 });
    });

    it('menerima angka yang diletakkan langsung di baris teratas', () => {
      const row = { order_sn: 'A1', escrow_amount: 500, commission_fee: 50, service_fee: 25 };

      expect(extractIncome(row)).toBe(row);
    });

    it('mengembalikan null bila baris tidak punya rincian sama sekali', () => {
      expect(extractIncome({ order_sn: 'A1' })).toBeNull();
    });
  });

  describe('describeShape', () => {
    it('menggambarkan array langsung', () => {
      expect(describeShape([{ a: 1 }, { a: 2 }])).toBe('array langsung berisi 2 baris');
    });

    it('menggambarkan objek dengan kunci indeks sebagai gejala', () => {
      expect(describeShape({ 0: {}, 1: {} })).toContain('kunci indeks');
    });

    it('tidak membocorkan nilai uang ke log', () => {
      const desc = describeShape({ escrow_amount: 999999, order_sn: 'A1' });

      expect(desc).not.toContain('999999');
      expect(desc).not.toContain('A1');
      expect(desc).toContain('escrow_amount');
    });
  });
});
