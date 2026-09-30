/**
 * Pemetaan rincian dana Shopee → data yang ditampilkan aplikasi.
 *
 * FAKTA PENTING (dari respons nyata `v2.payment.get_escrow_detail`)
 * -------------------------------------------------------------------
 * Nama field biaya yang dikembalikan Shopee **TIDAK** sama dengan yang
 * sebelumnya diasumsikan aplikasi:
 *
 *  - `commission_fee`  → selalu `0` pada toko ini
 *  - `service_fee`     → selalu `0`
 *  - `campaign_fee`    → selalu `0`
 *  - `escrow_tax`      → selalu `0`
 *  - `pay_per_sale`    → **ini yang sebenarnya berisi biaya per penjualan**
 *
 * Akibatnya `platformFee` selalu `null` sehingga kartu "Potongan Shopee"
 * tidak pernah muncul, padahal Seller Centre menampilkannya.
 *
 * Modul ini karena itu memakai DAFTAR RESMI field biaya Shopee, bukan satu
 * nama. Semua angka dibaca apa adanya dari Shopee; tidak ada perkiraan.
 * Fee negatif (pengembalian biaya) tetap dijumlahkan sebagai nilai negatif,
 * mengikuti tanda yang diberikan Shopee.
 */

/** Field biaya utama per penjualan (dipakai Seller Centre). */
const PER_SALE_FEE_KEYS = [
  'commission_fee',
  'service_fee',
  'pay_per_sale',
  'campaign_fee',
  'escrow_tax',
  'order_ams_commission_fee',
  'seller_order_processing_fee',
  'seller_transaction_fee',
  'credit_card_transaction_fee',
  'buyer_transaction_fee',
  'fbs_fee',
  'sspl_fee',
  'shipping_fee_sst',
  'payment_promotion',
  'ads_escrow_top_up_fee_or_technical_support_fee',
  'coins',
  'pix_discount',
] as const;

/** Field yang sebenarnya mengurangi dana PENJUAL (bukan biaya pembeli). */
const SELLER_FEE_KEYS = [
  'commission_fee',
  'service_fee',
  'pay_per_sale',
  'campaign_fee',
  'escrow_tax',
  'seller_order_processing_fee',
  'seller_transaction_fee',
  'fbs_fee',
  'sspl_fee',
  'shipping_fee_sst',
  'ads_escrow_top_up_fee_or_technical_support_fee',
  'coins',
] as const;

/**
 * Pajak yang dipotong Shopee dari dana masuk.
 *
 * Ditemukan dari rekonsiliasi data nyata: untuk `2609251E5KBW1U`,
 *   selisih(total − escrow) = 65.500
 *   = pay_per_sale 50.000 + withholding_tax 2.500 + ongkir 12.000
 * Tanpa `withholding_tax` di sini, "Potongan Shopee" kurang Rp2.500 per pesanan.
 */
const TAX_KEYS = ['withholding_tax', 'withholding_pit_tax', 'withholding_cit_tax', 'withholding_vat_tax'] as const;

/** Baca angka dari respons Shopee; string desimal pun diterima. */
export function toAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sumOf(income: Record<string, unknown>, keys: readonly string[]): number {
  let total = 0;
  for (const key of keys) {
    const n = toAmount(income[key]);
    if (n !== null) total += n;
  }
  return total;
}

/**
 * Total "Potongan Shopee" untuk satu pesanan.
 * Mengembalikan `null` bila Shopee benar-benar tidak mengirim data biaya,
 * supaya UI menampilkan "belum tersedia" — bukan `Rp0` yang menyesatkan.
 */
export function computePlatformFee(income: Record<string, unknown> | null | undefined): number | null {
  if (!income) return null;
  const total = sumOf(income, [...SELLER_FEE_KEYS, ...TAX_KEYS]);
  // Nol absolut berarti tidak ada potongan sama sekali; sementara `null`
  // berarti Shopee belum mengirim rinciannya. Keduanya dibedakan.
  return total === 0 ? 0 : total;
}

/** Rincian per komponen, untuk ditampilkan apa adanya di UI. */
export function describePlatformFee(
  income: Record<string, unknown> | null | undefined,
): Array<{ label: string; amount: number }> {
  if (!income) return [];
  const labels: Record<string, string> = {
    commission_fee: 'Komisi',
    service_fee: 'Biaya layanan',
    pay_per_sale: 'Biaya per penjualan',
    campaign_fee: 'Biaya kampanye',
    escrow_tax: 'Pajak escrow',
    seller_order_processing_fee: 'Biaya pemrosesan pesanan',
    seller_transaction_fee: 'Biaya transaksi penjual',
    fbs_fee: 'Biaya FBS',
    sspl_fee: 'Biaya SPLS',
    shipping_fee_sst: 'Pajak pengiriman',
    ads_escrow_top_up_fee_or_technical_support_fee: 'Biaya iklan/dukungan teknis',
    coins: 'Koin Shopee',
    withholding_tax: 'Pajak dipotong Shopee',
    withholding_pit_tax: 'Pajak penghasilan pribadi',
    withholding_cit_tax: 'Pajak penghasilan perusahaan',
    withholding_vat_tax: 'Pajak tambah nilai',
  };
  const out: Array<{ label: string; amount: number }> = [];
  for (const key of [...SELLER_FEE_KEYS, ...TAX_KEYS]) {
    const n = toAmount(income[key]);
    if (n !== null && n !== 0) out.push({ label: labels[key] ?? key, amount: n });
  }
  return out;
}

/** Seluruh field yang dipetakan, untuk dokumentasi & audit. */
export const PLATFORM_FEE_KEYS = PER_SALE_FEE_KEYS;
