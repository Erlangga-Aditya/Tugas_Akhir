import type { DownloadedLabel, LabelTarget, ShippingDocumentType } from './shipping-document';

/**
 * Marketplace Adapter Interface (Port) — ADR-006.
 * The domain/application layer depends on this interface, never on a provider SDK.
 * Shopee is the only implemented provider (ShopeeAdapter); the port remains a
 * clean seam so other channels can be added without touching the order domain.
 */

export interface MarketplaceOrderItem {
  externalItemId: string;
  externalVariantId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

/**
 * Rincian uang sebuah pesanan.
 * Semua opsional: Shopee hanya mengirim sebagian field tergantung status pesanan
 * (mis. `escrowAmount` baru terisi setelah pesanan selesai).
 */
export interface MarketplaceOrderPayment {
  currency: string | null;
  /** Total dibayar pembeli (termasuk ongkir). */
  totalAmount: number | null;
  /** Harga barang sebelum diskon. */
  itemSubtotal: number | null;
  /** Diskon ditanggung penjual. */
  sellerDiscount: number | null;
  /** Diskon ditanggung Shopee. */
  shopeeDiscount: number | null;
  /** Ongkir yang dibayar pembeli. */
  buyerShippingFee: number | null;
  /** Subsidi/potongan ongkir. */
  shippingFeeDiscount: number | null;
  /** Total potongan Shopee (komisi + biaya layanan). */
  platformFee: number | null;
  /** Estimasi uang masuk ke penjual. */
  escrowAmount: number | null;
  paymentMethod: string | null;
  isCod: boolean;
  paidAt: Date | null;
  packageNumber: string | null;
  /** Rincian mentah dari Shopee (cadangan). */
  income: Record<string, unknown> | null;
}

export interface MarketplaceOrder {
  externalOrderId: string;
  placedAt: Date;
  shipByAt: Date | null;
  buyerName: string | null;
  buyerPhone: string | null;
  buyerNote: string | null;
  shippingAddress: Record<string, unknown>;
  items: MarketplaceOrderItem[];
  rawStatus: string;
  trackingNumber: string | null;
  carrier: string | null;
  payment: MarketplaceOrderPayment | null;
  /**
   * Jumlah paket dari `package_list` Shopee; `null` = belum diketahui.
   *
   * Menentukan boleh-tidaknya `package_number` dikirim ke `ship_order`:
   * Shopee MENOLAK `package_number` untuk pesanan satu paket
   * (`logistics.ship_order_not_need_pacakge_number`) dan MEMBUTUHKANNYA untuk
   * pesanan multi-paket (`logistics.package_not_exist`). Bukti sandbox 2026-09-26.
   */
  packageCount?: number | null;
}

export interface MarketplaceProductVariant {
  externalVariantId: string;
  sku: string;
  barcode?: string | null;
  name: string;
  price?: number | null;
  stock?: number | null;
}

export interface MarketplaceProduct {
  externalProductId: string;
  name: string;
  sku: string;
  price: number | null;
  imageUrl: string | null;
  variants: MarketplaceProductVariant[];
}

export interface TrackingEvent {
  externalEventId: string;
  status: string;
  description: string;
  occurredAt: Date;
}

export interface TrackingInfo {
  awb: string;
  carrier: string;
  status: string;
  events: TrackingEvent[];
}

// ── Logistics / Shipping ──────────────────────────────────────────────────────

export interface ArrangeShipmentInput {
  /** Shopee internal order_sn. */
  orderSn: string;
  /** Shopee package_number (from package_list in order detail). */
  packageNumber?: string;
  /** Pickup or dropoff — default 'dropoff' if not specified. */
  pickupTimeId?: string;
  /** For dropoff: branch_id obtained from get_branch_list. */
  branchId?: number;
}

export interface ArrangeShipmentResult {
  success: boolean;
  trackingNumber: string | null;
  message?: string;
}

export interface SyncOptions {
  fromDate?: Date;
  toDate?: Date;
  pageSize?: number;
}

/** Hasil label resmi: file dari Shopee + format yang dipakainya. */
export interface OfficialLabelResult {
  label: DownloadedLabel;
  documentType: ShippingDocumentType;
}

export interface ShopCredentials {
  /** Provider shop id (Shopee numeric shop_id). */
  shopId: string;
  accessToken: string;
  partnerId: string;
  partnerKey: string;
  /** Override API host (e.g. sandbox). */
  apiHost?: string;
}

// ── Returns ───────────────────────────────────────────────────────────────────

export interface MarketplaceReturnItem {
  externalItemId: string;
  externalVariantId: string;
  sku: string;
  name: string;
  quantity: number;
}

export interface MarketplaceReturn {
  externalReturnId: string;
  externalOrderId: string;
  /** Provider-specific status string (e.g. "REQUESTED", "ACCEPTED"). */
  status: string;
  reason: string;
  items: MarketplaceReturnItem[];
  createdAt: Date;
}

// ── Adapter Interface ─────────────────────────────────────────────────────────

export interface MarketplaceAdapter {
  readonly provider: string;
  getOrders(credentials: ShopCredentials, options?: SyncOptions): Promise<MarketplaceOrder[]>;
  getOrderDetail(credentials: ShopCredentials, externalOrderId: string): Promise<MarketplaceOrder | null>;
  getProducts(credentials: ShopCredentials): Promise<MarketplaceProduct[]>;
  getReturns(credentials: ShopCredentials): Promise<MarketplaceReturn[]>;
  updateStock(credentials: ShopCredentials, externalVariantId: string, quantity: number): Promise<boolean>;
  /** Fetch AWB/resi number from logistics provider. */
  getTrackingNumber(credentials: ShopCredentials, orderSn: string): Promise<string | null>;
  /** Fetch full tracking info (AWB + events). */
  getTrackingInfo(credentials: ShopCredentials, orderSn: string): Promise<TrackingInfo | null>;
  /** Trigger "Atur Pengiriman" for an incoming order (required before AWB is issued). */
  arrangeShipment(credentials: ShopCredentials, input: ArrangeShipmentInput): Promise<ArrangeShipmentResult>;
  /**
   * Ambil label resmi Shopee untuk satu paket: parameter → create → result → download.
   * Mengembalikan file label apa adanya; tidak pernah mengarang resi maupun URL.
   */
  fetchOfficialShippingLabel(credentials: ShopCredentials, target: LabelTarget): Promise<OfficialLabelResult>;
  /** Verify a webhook/push signature (provider-specific). */
  verifyWebhookSignature(url: string, rawBody: string, signature: string, partnerKey: string): boolean;
}
