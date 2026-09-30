import { prisma } from '@/shared/infrastructure/prisma';

/**
 * Laporan keuangan sederhana untuk penjual.
 *
 * Sumber angka = rincian uang yang dikirim Shopee pada setiap pesanan
 * (total dibayar pembeli, ongkir, diskon, potongan Shopee, estimasi dana masuk).
 * Kalau sebuah pesanan belum punya rincian itu, pesanan tetap muncul di daftar
 * dengan penanda "belum ada rincian" — bukan dianggap nol secara diam-diam.
 */

export interface FinanceReportParams {
  from?: Date;
  to?: Date;
  shopId?: string;
}

export interface FinanceOrderRow {
  id: string;
  externalOrderId: string;
  placedAt: Date;
  status: string;
  buyerName: string | null;
  shopName: string;
  paymentMethod: string | null;
  isCod: boolean;
  currency: string | null;
  totalAmount: number | null;
  itemSubtotal: number | null;
  sellerDiscount: number | null;
  shopeeDiscount: number | null;
  buyerShippingFee: number | null;
  shippingFeeDiscount: number | null;
  platformFee: number | null;
  escrowAmount: number | null;
  hasMoneyDetail: boolean;
}

export interface FinanceReportResult {
  range: { from: string; to: string };
  totals: {
    orderCount: number;
    ordersWithDetail: number;
    grossSales: number;
    sellerDiscount: number;
    shopeeDiscount: number;
    buyerShippingFee: number;
    shippingFeeDiscount: number;
    platformFee: number;
    buyerPaid: number;
    estimatedPayout: number;
    codCount: number;
  };
  daily: Array<{ date: string; orderCount: number; buyerPaid: number; estimatedPayout: number }>;
  byPaymentMethod: Array<{ method: string; orderCount: number; buyerPaid: number }>;
  orders: FinanceOrderRow[];
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export async function getFinanceReport(
  tenantId: string,
  params: FinanceReportParams = {},
): Promise<FinanceReportResult> {
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
  const from = startOfDay(params.from ?? defaultFrom);
  const to = endOfDay(params.to ?? now);

  const orders = await prisma.order.findMany({
    where: {
      tenantId,
      ...(params.shopId ? { shopId: params.shopId } : {}),
      placedAt: { gte: from, lte: to },
      status: { notIn: ['CANCELLED'] },
    },
    select: {
      id: true,
      externalOrderId: true,
      placedAt: true,
      status: true,
      buyerName: true,
      shop: { select: { name: true } },
      paymentMethod: true,
      isCod: true,
      currency: true,
      totalAmount: true,
      itemSubtotal: true,
      sellerDiscount: true,
      shopeeDiscount: true,
      buyerShippingFee: true,
      shippingFeeDiscount: true,
      platformFee: true,
      escrowAmount: true,
    },
    orderBy: { placedAt: 'desc' },
    take: 2000,
  });

  const rows: FinanceOrderRow[] = orders.map((o) => ({
    id: o.id,
    externalOrderId: o.externalOrderId,
    placedAt: o.placedAt,
    status: o.status,
    buyerName: o.buyerName,
    shopName: o.shop.name,
    paymentMethod: o.paymentMethod,
    isCod: o.isCod,
    currency: o.currency,
    totalAmount: o.totalAmount,
    itemSubtotal: o.itemSubtotal,
    sellerDiscount: o.sellerDiscount,
    shopeeDiscount: o.shopeeDiscount,
    buyerShippingFee: o.buyerShippingFee,
    shippingFeeDiscount: o.shippingFeeDiscount,
    platformFee: o.platformFee,
    escrowAmount: o.escrowAmount,
    // "Punya rincian" berarti Shopee sudah mengirim bagian yang WAJIB untuk
    // menghitung dana masuk: `platformFee` dan `escrowAmount`. Sebelumnya
    // hanya `totalAmount` yang dicek, padahal `totalAmount` selalu terisi —
    // sehingga order yang fee-nya masih kosong ikut dihitung "sudah rinci",
    // dan kartu Potongan Shopee menampilkan Rp0 palsu.
    hasMoneyDetail: o.platformFee !== null && o.escrowAmount !== null,
  }));

  const sumOf = (key: keyof FinanceOrderRow): number =>
    rows.reduce((sum, r) => sum + (typeof r[key] === 'number' ? (r[key] as number) : 0), 0);

  const dailyMap = new Map<string, { orderCount: number; buyerPaid: number; estimatedPayout: number }>();
  for (const r of rows) {
    const key = r.placedAt.toISOString().slice(0, 10);
    const bucket = dailyMap.get(key) ?? { orderCount: 0, buyerPaid: 0, estimatedPayout: 0 };
    bucket.orderCount += 1;
    bucket.buyerPaid += r.totalAmount ?? 0;
    bucket.estimatedPayout += r.escrowAmount ?? 0;
    dailyMap.set(key, bucket);
  }

  const methodMap = new Map<string, { orderCount: number; buyerPaid: number }>();
  for (const r of rows) {
    const key = r.isCod ? 'COD (bayar di tempat)' : (r.paymentMethod ?? 'Belum diketahui');
    const bucket = methodMap.get(key) ?? { orderCount: 0, buyerPaid: 0 };
    bucket.orderCount += 1;
    bucket.buyerPaid += r.totalAmount ?? 0;
    methodMap.set(key, bucket);
  }

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    totals: {
      orderCount: rows.length,
      ordersWithDetail: rows.filter((r) => r.hasMoneyDetail).length,
      grossSales: sumOf('itemSubtotal'),
      sellerDiscount: sumOf('sellerDiscount'),
      shopeeDiscount: sumOf('shopeeDiscount'),
      buyerShippingFee: sumOf('buyerShippingFee'),
      shippingFeeDiscount: sumOf('shippingFeeDiscount'),
      platformFee: sumOf('platformFee'),
      buyerPaid: sumOf('totalAmount'),
      estimatedPayout: sumOf('escrowAmount'),
      codCount: rows.filter((r) => r.isCod).length,
    },
    daily: [...dailyMap.entries()]
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => (a.date < b.date ? 1 : -1)),
    byPaymentMethod: [...methodMap.entries()]
      .map(([method, v]) => ({ method, ...v }))
      .sort((a, b) => b.buyerPaid - a.buyerPaid),
    orders: rows,
  };
}
