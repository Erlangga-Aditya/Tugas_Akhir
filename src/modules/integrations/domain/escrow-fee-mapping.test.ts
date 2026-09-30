import { describe, it, expect } from 'vitest';
import { computePlatformFee, describePlatformFee, toAmount } from './escrow-fee-mapping';

/**
 * Regresi untuk "Potongan Shopee (komisi & layanan) tidak muncul".
 *
 * Bukti dari respons nyata `v2.payment.get_escrow_detail` di toko ini:
 *   - `commission_fee` = 0, `service_fee` = 0, `campaign_fee` = 0, `escrow_tax` = 0
 *   - `pay_per_sale`   = 50000 (biaya sebenarnya)
 * Versi lama hanya menjumlahkan empat field pertama, sehingga hasilnya 0
 * dan disimpan sebagai `null` — kartu Potongan Shopee tidak pernah muncul.
 */
describe('pemetaan Potongan Shopee dari escrow', () => {
  describe('toAmount', () => {
    it('membaca number dan string desimal alike', () => {
      expect(toAmount(1000)).toBe(1000);
      expect(toAmount('1234.5')).toBe(1234.5);
      expect(toAmount(0)).toBe(0);
    });

    it('mengembalikan null untuk nilai yang tidak ada', () => {
      expect(toAmount(null)).toBeNull();
      expect(toAmount(undefined)).toBeNull();
      expect(toAmount('')).toBeNull();
      expect(toAmount('bukan angka')).toBeNull();
    });
  });

  describe('computePlatformFee', () => {
    it('mengambil biaya dari pay_per_sale (nama field asli Shopee)', () => {
      const income = { commission_fee: 0, service_fee: 0, pay_per_sale: 50000 };

      expect(computePlatformFee(income)).toBe(50000);
    });

    it('menjumlahkan seluruh komponen biaya yang tidak nol', () => {
      const income = { commission_fee: 1000, service_fee: 500, pay_per_sale: 20000 };

      expect(computePlatformFee(income)).toBe(21500);
    });

    it('membedakan "tidak ada potongan" (0) dari "belum ada data" (null)', () => {
      expect(computePlatformFee({})).toBe(0);
      expect(computePlatformFee({ commission_fee: 0 })).toBe(0);
      expect(computePlatformFee(null)).toBeNull();
      expect(computePlatformFee(undefined)).toBeNull();
    });

    it('mempertahankan tanda negatif dari Shopee (biaya dikembalikan)', () => {
      expect(computePlatformFee({ pay_per_sale: -5000 })).toBe(-5000);
    });

    it('menambah pajak yang dipotong Shopee (withholding_tax)', () => {
      // Rekonsiliasi data nyata 2609251E5KBW1U:
      //   selisih(total − escrow) = 65.500
      //   = pay_per_sale 50.000 + withholding_tax 2.500 + ongkir 12.000
      // Jadi potongan = 50.000 + 2.500 = 52.500 (ongkir bukan potongan).
      const income = { pay_per_sale: 50000, withholding_tax: 2500, actual_shipping_fee: 12000 };

      expect(computePlatformFee(income)).toBe(52500);
    });

    it('TIDAK menghitung ongkir sebagai potongan (ongkir dibayar pembeli)', () => {
      expect(computePlatformFee({ actual_shipping_fee: 12000 })).toBe(0);
    });

    it('TIDAK menghitung buyer/credit-card fee (dipotong dari pembeli)', () => {
      expect(computePlatformFee({ buyer_transaction_fee: 900, credit_card_transaction_fee: 900 })).toBe(0);
    });

    it('menggabungkan seluruh komponen biaya yang tidak nol', () => {
      const income = { commission_fee: 1000, pay_per_sale: 20000, withholding_tax: 500 };

      expect(computePlatformFee(income)).toBe(21500);
    });
  });

  describe('describePlatformFee', () => {
    it('menampilkan rincian per komponen dengan label Bahasa Indonesia', () => {
      const rincian = describePlatformFee({ commission_fee: 1000, pay_per_sale: 50000 });

      expect(rincian).toEqual([
        { label: 'Komisi', amount: 1000 },
        { label: 'Biaya per penjualan', amount: 50000 },
      ]);
    });

    it('mengembalikan array kosong bila tidak ada rincian', () => {
      expect(describePlatformFee(null)).toEqual([]);
      expect(describePlatformFee({})).toEqual([]);
    });
  });
});
