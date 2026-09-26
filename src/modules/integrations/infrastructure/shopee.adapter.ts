import crypto from 'crypto';
import type {
  MarketplaceAdapter,
  MarketplaceOrder,
  MarketplaceProduct,
  MarketplaceProductVariant,
  ShopCredentials,
  SyncOptions,
  TrackingInfo,
  ArrangeShipmentInput,
  ArrangeShipmentResult,
} from '../domain/marketplace.adapter';
import type { MarketplaceReturn } from '../domain/marketplace.adapter';
import {
  type DocumentParameter,
  type DocumentTask,
  type DownloadedLabel,
  type LabelTarget,
  type ShippingDocumentType,
  type ShopeeConfig,
  assertHasTrackingNumber,
  describeLabelFailure,
  pollUntilReady,
} from '../domain/shipping-document';
import { describeShape, extractEscrowList, extractIncome } from '../domain/escrow-detail';
import {
  describeNoChannel,
  extractSupportedChannels,
  pickChannel,
} from '../domain/shipping-channel';
import {
  createDocument,
  downloadDocument,
  getDocumentParameters,
  getDocumentResult,
} from './shopee-shipping-document.client';
import { ExternalIntegrationError } from '@/shared/errors/AppError';
import { logger } from '@/shared/observability/logger';

/**
 * Real Shopee Open Platform v2 adapter (partner/ISV app).
 *
 * Every fact below was VERIFIED against the official docs (2026-09-17), see
 * 08-INTEGRATION-SHOPEE.md and 20-SHOPEE-API-REFERENCE.md. Key rules:
 *  - Sign = HMAC-SHA256(partner_id + api_path + timestamp [+ access_token + shop_id]) → lowercase HEX.
 *    Public API omits access_token/shop_id from base string.
 *  - POST: common params in query string, request params in JSON body.
 *  - get_order_list window max 15 days, cursor pagination.
 *  - access_token 4h, refresh_token 30d (single-use), code 10min.
 *  - All API responses: { error, message, request_id, response: <data> }
 *    EXCEPT auth/* which return token fields at top-level (no .response wrapper).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface ShopeeTokenResponse {
  access_token: string;
  refresh_token: string;
  expire_in: number; // seconds
  shop_id_list?: number[];
  merchant_id_list?: number[];
  error?: string;
  message?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal config & crypto helpers
// ─────────────────────────────────────────────────────────────────────────────

import { getShopeeAppConfig } from '../application/appConfig.service';

/**
 * Kredensial partner diambil dari konfigurasi aplikasi (UI/DB) dengan fallback .env.
 * Wajib terisi sebelum integrasi Shopee bisa dipakai.
 */
async function configFromStore(): Promise<ShopeeConfig> {
  const cfg = await getShopeeAppConfig();
  if (!cfg.partnerId || !cfg.partnerKey) {
    throw new ExternalIntegrationError(
      'shopee',
      'Kredensial partner Shopee belum dikonfigurasi. Isi Partner ID & Partner Key di halaman Integrasi.',
    );
  }
  return { partnerId: cfg.partnerId, partnerKey: cfg.partnerKey, apiHost: cfg.apiHost };
}

/**
 * Base string untuk tanda tangan Shopee (developer-guide §2.1).
 *
 * Setiap endpoint punya aturan parameter sendiri, dan Shopee menolak keras
 * bila kombinasi salah. Bukti dari error produksi:
 *
 *  - `get_escrow_detail_batch` tanpa `shop_id`      → "There is no shop_id in query"
 *  - `get_escrow_detail_batch` tanpa `access_token` → "There is no access_token in query"
 *  - signature app-level (`partner_id + path + timestamp` saja) → "error_sign"
 *
 * Jadi untuk endpoint Shopee yang dipakai aplikasi ini, kombinasinya selalu
 * `access_token` + `shop_id`. Scope `app` tetap dipertahankan untuk endpoint
 * publik (mis. tukar access token) yang memang tidak memakai kredensial toko.
 */
export type ShopeeAuthScope = 'shop' | 'app';

function buildBaseString(
  partnerId: string,
  apiPath: string,
  timestamp: number,
  accessToken?: string,
  shopId?: string,
  scope: ShopeeAuthScope = 'shop',
): string {
  if (scope === 'app') {
    return `${partnerId}${apiPath}${timestamp}`;
  }
  return `${partnerId}${apiPath}${timestamp}${accessToken ?? ''}${shopId ?? ''}`;
}

export function signShopee(
  partnerId: string,
  partnerKey: string,
  apiPath: string,
  timestamp: number,
  accessToken?: string,
  shopId?: string,
  scope: ShopeeAuthScope = 'shop',
): string {
  return crypto
    .createHmac('sha256', partnerKey)
    .update(buildBaseString(partnerId, apiPath, timestamp, accessToken, shopId, scope))
    .digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────────
// Core HTTP client for Shopee API
// ─────────────────────────────────────────────────────────────────────────────

interface ShopeeRawResponse {
  error?: string;
  message?: string;
  request_id?: string;
  response?: unknown;
  // Auth endpoints return tokens at top-level instead of inside .response
  access_token?: string;
  refresh_token?: string;
  expire_in?: number;
}

export interface ShopeeRequestOptions {
  method?: 'GET' | 'POST';
  params?: Record<string, unknown>;
  body?: Record<string, unknown>;
  /**
   * `shop` (default) memakai access_token + shop_id di signature dan query.
   * `app` hanya memakai partner_id + path + timestamp — untuk endpoint
   * yang diotorisasi di level aplikasi (mis. `payment/get_escrow_detail_batch`).
   */
  authScope?: ShopeeAuthScope;
}

/**
 * Make a signed Shopee API call.
 * - HTTP GET: query params serialized to URL search string (for read APIs)
 * - HTTP POST: common auth params in query string, payload in JSON body (for write APIs)
 * Handles: connection errors, non-JSON responses, Shopee API errors.
 * Returns the `.response` sub-object when present, otherwise the full body.
 */
async function callShopee<T>(
  cfg: ShopeeConfig,
  apiPath: string,
  optionsOrBody: ShopeeRequestOptions | Record<string, unknown>,
  creds?: { shopId?: string; accessToken?: string },
): Promise<T> {
  const isOptionsObject =
    optionsOrBody &&
    typeof optionsOrBody === 'object' &&
    ('method' in optionsOrBody || 'params' in optionsOrBody || 'body' in optionsOrBody);

  const method: 'GET' | 'POST' = isOptionsObject
    ? (optionsOrBody as ShopeeRequestOptions).method ?? 'GET'
    : 'POST';

  const params: Record<string, unknown> = isOptionsObject
    ? (optionsOrBody as ShopeeRequestOptions).params ?? {}
    : {};

  const body: Record<string, unknown> | undefined = isOptionsObject
    ? (optionsOrBody as ShopeeRequestOptions).body
    : (optionsOrBody as Record<string, unknown>);

  // Endpoint app-level tidak memakai access_token. `shopIdOnly` tetap mengirim
  // shop_id karena endpoint escrow mewajibkannya.
  const authScope: ShopeeAuthScope = isOptionsObject
    ? (optionsOrBody as ShopeeRequestOptions).authScope ?? 'shop'
    : 'shop';

  const timestamp = Math.floor(Date.now() / 1000);
  const shopId = authScope === 'app' ? undefined : creds?.shopId;
  const accessToken = authScope === 'shop' ? creds?.accessToken : undefined;
  const sign = signShopee(cfg.partnerId, cfg.partnerKey, apiPath, timestamp, accessToken, shopId, authScope);

  const url = new URL(apiPath, cfg.apiHost);
  url.searchParams.set('partner_id', cfg.partnerId);
  url.searchParams.set('timestamp', String(timestamp));
  url.searchParams.set('sign', sign);
  if (accessToken) url.searchParams.set('access_token', accessToken);
  if (shopId) url.searchParams.set('shop_id', shopId);

  if (method === 'GET' && params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) {
        // Shopee UNTUK list expects format JSON, contoh:
        //   order_sn_list=["A","B"]
        // Kalau ditulis `order_sn_list=A&order_sn_list=B`, Shopee menjawab:
        //   "order_sn_list is required, format should be string[]"
        // Endpoint yang memang menerima pengulangan parameter tidak terpengaruh —
        // pemanggil memakai bentuk JSON secara eksplisit bila memang perlu.
        url.searchParams.set(k, JSON.stringify(v));
      } else {
        url.searchParams.set(k, String(v));
      }
    }
  }

  let res: Response;
  try {
    const fetchInit: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (method === 'POST' && body) {
      fetchInit.body = JSON.stringify(body);
    }
    res = await fetch(url.toString(), fetchInit);
  } catch (err) {
    throw new ExternalIntegrationError(
      'shopee',
      `Tidak dapat terhubung ke Shopee API (${apiPath}): ${(err as Error).message}`,
    );
  }

  // ── Safe JSON parsing ──────────────────────────────────────────────────────
  let rawText: string;
  try {
    rawText = await res.text();
  } catch (err) {
    throw new ExternalIntegrationError(
      'shopee',
      `Gagal membaca response dari Shopee API (${apiPath}): ${(err as Error).message}`,
    );
  }

  let json: ShopeeRawResponse;
  try {
    json = JSON.parse(rawText) as ShopeeRawResponse;
  } catch {
    logger.error('Shopee API mengembalikan response non-JSON', {
      apiPath,
      httpStatus: res.status,
      body: rawText.slice(0, 500),
    });
    throw new ExternalIntegrationError(
      'shopee',
      `Shopee API mengembalikan response tidak valid (HTTP ${res.status}) di ${apiPath}. ` +
        `Respons: ${rawText.slice(0, 200)}`,
    );
  }

  // ── Shopee API-level error handling ───────────────────────────────────────
  if (json.error && json.error !== '') {
    const msg = `Shopee API error [${json.error}] pada ${apiPath}: ${json.message ?? '(no message)'}`;
    logger.error(msg, { apiPath, request_id: json.request_id, error: json.error });
    throw new ExternalIntegrationError('shopee', msg, {
      providerCode: json.error,
      requestId: json.request_id,
      apiPath,
    });
  }

  return ((json.response as T) ?? (json as unknown as T));
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────────────────────────────────────

function toDate(ts: unknown): Date | null {
  if (typeof ts !== 'number' || ts <= 0) return null;
  return new Date(ts * 1000);
}

/** Map Shopee order_status → internal rawStatus string (kept provider-agnostic upstream). */
export function mapShopeeOrderStatus(status: string): string {
  return status; // pass-through; sync.service maps to internal OrderStatus enum
}

// ─────────────────────────────────────────────────────────────────────────────
// ShopeeAdapter — implements MarketplaceAdapter port
// ─────────────────────────────────────────────────────────────────────────────

export class ShopeeAdapter implements MarketplaceAdapter {
  readonly provider = 'shopee';

  private async cfg(): Promise<ShopeeConfig> {
    return configFromStore();
  }

  // ── Auth ─────────────────────────────────────────────────────────────────

  /**
   * Build the authorization URL (seller grants access).
   * Verified Shopee OpenAPI v2 spec:
   * Endpoint: /api/v2/shop/auth_partner
   * Query params: partner_id, timestamp, sign, redirect, [state]
   * Base String: partner_id + "/api/v2/shop/auth_partner" + timestamp
   * Sign: HMAC-SHA256(baseString, partner_key)
   */
  async buildAuthUrl(redirectUri: string, state?: string): Promise<string> {
    const { partnerId, partnerKey, apiHost } = await this.cfg();
    const timestamp = Math.floor(Date.now() / 1000);
    const apiPath = '/api/v2/shop/auth_partner';
    const baseString = `${partnerId}${apiPath}${timestamp}`;
    const sign = crypto
      .createHmac('sha256', partnerKey)
      .update(baseString)
      .digest('hex');

    const params = new URLSearchParams({
      partner_id: partnerId,
      timestamp: String(timestamp),
      sign,
      redirect: redirectUri,
    });
    if (state) params.set('state', state);
    return `${apiHost}${apiPath}?${params.toString()}`;
  }

  /** Exchange authorization `code` → tokens (public API, no shop creds needed). */
  async exchangeCodeForToken(code: string, shopId?: string, mainAccountId?: string): Promise<ShopeeTokenResponse> {
    const cfg = await this.cfg();
    const body: Record<string, unknown> = { code, partner_id: Number(cfg.partnerId) };
    if (shopId) body.shop_id = Number(shopId);
    if (mainAccountId) body.main_account_id = Number(mainAccountId);
    const res = await callShopee<Record<string, unknown>>(cfg, '/api/v2/auth/token/get', {
      method: 'POST',
      body,
    });
    return res as unknown as ShopeeTokenResponse;
  }

  /**
   * Uji kredensial partner lewat Public API Shopee.
   * Dipakai tombol "Uji Koneksi" di halaman Integrasi — pesannya apa adanya dari Shopee.
   */
  async testCredentials(): Promise<{ ok: boolean; message: string; shopCount?: number }> {
    const cfg = await this.cfg();
    try {
      const res = await callShopee<Record<string, unknown>>(cfg, '/api/v2/public/get_shops_by_partner', {
        method: 'GET',
        params: { page_size: 1, page_no: 1 },
      });
      const shops = (res?.shops as unknown[]) ?? [];
      return {
        ok: true,
        message: `Kredensial partner valid — Shopee mengenali aplikasi Anda (${shops.length} toko terdaftar).`,
        shopCount: shops.length,
      };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  /** Refresh access_token using a single-use refresh_token (public API). */
  async refreshAccessToken(refreshToken: string, shopId: string): Promise<ShopeeTokenResponse> {
    const cfg = await this.cfg();
    const res = await callShopee<Record<string, unknown>>(cfg, '/api/v2/auth/access_token/get', {
      method: 'POST',
      body: {
        refresh_token: refreshToken,
        partner_id: Number(cfg.partnerId),
        shop_id: Number(shopId),
      },
    });
    return res as unknown as ShopeeTokenResponse;
  }

  // ── Orders ────────────────────────────────────────────────────────────────

  /** Paginate order list (cursor-based) for a given time window (max 15 days). Uses HTTP GET. */
  private async getOrderList(
    cfg: ShopeeConfig,
    creds: ShopCredentials,
    options?: SyncOptions,
  ): Promise<Array<{ orderSn: string; status: string }>> {
    const now = Math.floor(Date.now() / 1000);
    const to = options?.toDate ? Math.floor(options.toDate.getTime() / 1000) : now;
    // Default window: last 14 days (stay safely within 15-day limit)
    const from = options?.fromDate ? Math.floor(options.fromDate.getTime() / 1000) : to - 14 * 24 * 3600;

    const results: Array<{ orderSn: string; status: string }> = [];
    let cursor = '';
    let more = true;

    while (more) {
      const params: Record<string, unknown> = {
        time_range_field: 'create_time',
        time_from: from,
        time_to: to,
        page_size: 50,
        response_optional_fields: 'order_status',
        request_order_status_pending: true,
      };
      if (cursor) {
        params.cursor = cursor;
      }

      const res = await callShopee<Record<string, unknown>>(
        cfg,
        '/api/v2/order/get_order_list',
        {
          method: 'GET',
          params,
        },
        { shopId: creds.shopId, accessToken: creds.accessToken },
      );
      const list = (res?.order_list as Array<{ order_sn?: string; order_status?: string }>) ?? [];
      for (const o of list) {
        if (o.order_sn) results.push({ orderSn: o.order_sn, status: o.order_status ?? '' });
      }
      more = (res?.more as boolean) === true;
      cursor = (res?.next_cursor as string) ?? '';
      if (!cursor && more) break;
    }
    return results;
  }

  /** Fetch full order details in batches of 50 via HTTP GET. */
  private async getOrderDetails(
    cfg: ShopeeConfig,
    creds: ShopCredentials,
    orderSns: string[],
  ): Promise<Record<string, unknown>[]> {
    const all: Record<string, unknown>[] = [];
    // Daftar resmi `response_optional_fields` untuk v2.order.get_order_detail
    // (dokumentasi: open.shopee.com/documents/v2/v2.order.get_order_detail, api_id 557).
    // CATATAN PENTING: `currency` & `cod` sudah dikirim secara bawaan;
    // rincian biaya (komisi, dana dilepas) TIDAK ada di endpoint ini — harus diambil
    // lewat modul Payment: v2.payment.get_escrow_detail(_batch).
    const OPTIONAL = [
      'buyer_username',
      'recipient_address',
      'actual_shipping_fee',
      'estimated_shipping_fee',
      'item_list',
      'pay_time',
      'payment_method',
      'payment_info',
      'package_list',
      'shipping_carrier',
      'total_amount',
      'note',
      'buyer_cancel_reason',
      'pickup_done_time',
      'fulfillment_flag',
    ].join(',');

    for (let i = 0; i < orderSns.length; i += 50) {
      const batch = orderSns.slice(i, i + 50);
      const res = await callShopee<Record<string, unknown>>(
        cfg,
        '/api/v2/order/get_order_detail',
        {
          method: 'GET',
          params: {
            order_sn_list: batch.join(','),
            response_optional_fields: OPTIONAL,
            request_order_status_pending: true,
          },
        },
        { shopId: creds.shopId, accessToken: creds.accessToken },
      );
      const list = (res?.order_list as Record<string, unknown>[]) ?? [];
      all.push(...list);
    }
    return all;
  }

  async getOrders(creds: ShopCredentials, options?: SyncOptions): Promise<MarketplaceOrder[]> {
    const cfg = await this.cfg();
    const summaries = await this.getOrderList(cfg, creds, options);
    if (summaries.length === 0) return [];
    logger.info(`Shopee: ditemukan ${summaries.length} pesanan, mengambil detail...`, { shopId: creds.shopId });
    const details = await this.getOrderDetails(cfg, creds, summaries.map((s) => s.orderSn));
    return details.map((d) => this.mapOrder(d)).filter((o): o is MarketplaceOrder => o !== null);
  }

  async getOrderDetail(creds: ShopCredentials, externalOrderId: string): Promise<MarketplaceOrder | null> {
    const cfg = await this.cfg();
    const details = await this.getOrderDetails(cfg, creds, [externalOrderId]);
    return details.length ? this.mapOrder(details[0]!) : null;
  }

  private mapOrder(d: Record<string, unknown>): MarketplaceOrder | null {
    const orderSn = typeof d.order_sn === 'string' ? d.order_sn : null;
    if (!orderSn) return null;

    const itemsRaw = (d.item_list as Array<Record<string, unknown>>) ?? [];
    const items = itemsRaw.map((it) => {
      const itemId = String(it.item_id ?? '');
      const modelId = it.model_id != null && Number(it.model_id) !== 0 ? String(it.model_id) : '';
      const externalVariantId = modelId || itemId;
      const rawSku = String(it.model_sku ?? it.item_sku ?? '').trim();
      const sku = rawSku || (modelId ? `SHOPEE-${itemId}-${modelId}` : `SHOPEE-${itemId}`);

      return {
        externalItemId: itemId,
        externalVariantId,
        sku,
        name: String(it.model_name ?? it.item_name ?? ''),
        quantity: Number(it.model_quantity_purchased ?? it.model_quantity ?? 1),
        unitPrice: Number(it.model_discounted_price ?? it.model_original_price ?? 0),
      };
    });

    const recipient = (d.recipient_address ?? {}) as Record<string, unknown>;
    const packages = (d.package_list as Array<Record<string, unknown>>) ?? [];
    const firstPackage = packages[0] ?? {};
    const trackingNumber =
      (firstPackage.tracking_number as string) ?? (firstPackage.tracking_no as string) ?? null;

    // ── Rincian uang ─────────────────────────────────────────────────────────
    // Sumber utama: objek `order_income` dari Shopee. Kalau belum tersedia
    // (pesanan baru dibayar), dipakai nilai level pesanan yang ada.
    // Rincian dari modul Payment (diisi menyusul oleh syncEscrowDetailsForShop).
    const income = (d.order_income ?? null) as Record<string, unknown> | null;
    const numOf = (...values: unknown[]): number | null => {
      for (const v of values) {
        if (v === null || v === undefined || v === '') continue;
        const n = Number(v);
        if (Number.isFinite(n)) return n;
      }
      return null;
    };
    const itemsSubtotal = items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0);
    const commissionFee = numOf(income?.commission_fee) ?? 0;
    const serviceFee = numOf(income?.service_fee) ?? 0;
    const sellerTransactionFee = numOf(income?.seller_transaction_fee) ?? 0;
    const totalPlatformFee = commissionFee + serviceFee + sellerTransactionFee;
    const payment = {
      currency: (d.currency as string) ?? (income?.currency as string) ?? null,
      totalAmount: numOf(d.total_amount, income?.buyer_paid_amount),
      itemSubtotal: numOf(income?.order_selling_price) ?? (itemsSubtotal > 0 ? itemsSubtotal : null),
      // Nama field sesuai dokumentasi Payment (get_escrow_detail):
      // seller_discount / order_seller_discount, shopee_discount, buyer_paid_shipping_fee,
      // shipping_fee_discount_from_3pl, commission_fee, service_fee, campaign_fee, escrow_tax.
      sellerDiscount: numOf(income?.seller_discount, income?.order_seller_discount),
      shopeeDiscount: numOf(income?.shopee_discount, income?.original_shopee_discount),
      buyerShippingFee: numOf(
        income?.buyer_paid_shipping_fee,
        income?.actual_shipping_fee,
        income?.final_shipping_fee,
        d.actual_shipping_fee,
      ),
      shippingFeeDiscount: numOf(income?.shipping_fee_discount_from_3pl, income?.shopee_shipping_rebate),
      platformFee: totalPlatformFee > 0 ? totalPlatformFee : null,
      escrowAmount: numOf(income?.escrow_amount_after_adjustment, income?.escrow_amount),
      paymentMethod: (d.payment_method as string) ?? null,
      isCod: Boolean(d.cod),
      paidAt: toDate(d.pay_time),
      packageNumber: (firstPackage.package_number as string) ?? null,
      income,
    };

    return {
      externalOrderId: orderSn,
      placedAt: toDate(d.create_time) ?? new Date(),
      shipByAt: toDate(d.ship_by_date),
      buyerName: (d.buyer_username as string) ?? null,
      buyerPhone: (recipient.phone as string) ?? null,
      shippingAddress: {
        name: recipient.name ?? null,
        phone: recipient.phone ?? null,
        fullAddress: recipient.full_address ?? null,
        city: recipient.city ?? null,
        district: recipient.district ?? null,
        state: recipient.state ?? null,
        region: recipient.region ?? null,
        town: recipient.town ?? null,
        zipcode: recipient.zipcode ?? null,
      },
      buyerNote: (d.note as string) ?? (d.message_to_seller as string) ?? null,
      items,
      rawStatus: String(d.order_status ?? ''),
      trackingNumber,
      carrier: (firstPackage.shipping_carrier as string) ?? (d.shipping_carrier as string) ?? null,
      payment,
    };
  }

  // ── Products ──────────────────────────────────────────────────────────────

  /**
   * Fetch all products + variants from Shopee via HTTP GET.
   * Uses: get_item_list (GET) → get_item_base_info (GET) → get_model_list (GET).
   */
  /**
   * Rincian biaya & dana yang dilepas ke penjual (modul Payment).
   *
   * Endpoint resmi: POST /api/v2/payment/get_escrow_detail_batch (maks 50 order per panggilan),
   * dokumentasi: open.shopee.com/documents/v2/v2.payment.get_escrow_detail_batch.
   * Hasilnya berisi antara lain: order_selling_price, seller_discount, shopee_discount,
   * buyer_paid_shipping_fee, shipping_fee_discount_from_3pl, commission_fee, service_fee,
   * escrow_tax, dan escrow_amount (dana yang dilepas ke penjual).
   *
   * Catatan resmi: `escrow_amount` masih bisa berubah sebelum pesanan selesai.
   */
  async getEscrowDetails(
    creds: ShopCredentials,
    orderSns: string[],
  ): Promise<Map<string, Record<string, unknown>>> {
    const cfg = await this.cfg();
    const result = new Map<string, Record<string, unknown>>();
    if (orderSns.length === 0) return result;

    // Satu panggilan per pesanan. Endpoint `get_escrow_detail` bekerja per
    // `order_sn`, bukan daftar, jadi tidak ada lagi batas 50 per panggilan.
    for (const orderSn of orderSns) {
      try {
        // WAJIB GET. Dikonfirmasi di Shopee API Test Tool (Partner 1245182 →
        // Payment → v2.payment.get_escrow_detail): "Http Method: GET".
        // `get_escrow_detail_batch` dijawab `order_sn_list is required,
        // format should be string[]` dengan request_id kosong, artinya tidak
        // tersedia untuk app ini — bukan karena format-nya salah.
        const res = await callShopee<unknown>(
          cfg,
          '/api/v2/payment/get_escrow_detail',
          {
            method: 'GET',
            params: { order_sn: orderSn },
            authScope: 'shop',
          },
          { shopId: creds.shopId, accessToken: creds.accessToken },
        );

        // Toleran terhadap bentuk respons: bisa array, objek pembungkus, atau
        // objek berkunci indeks.
        const rows: Array<Record<string, unknown>> = extractEscrowList(res);
        // Rincian satu pesanan: barisnya boleh tanpa `order_sn`, jadi cari
        // lewat nomor pesanan yang diminta, lalu fallback ke Income langsung.
        const single: Record<string, unknown> | null =
          typeof res === 'object' && res !== null && !Array.isArray(res)
            ? extractIncome(res as Record<string, unknown>)
            : null;
        const match = rows.find((r) => String(r.order_sn ?? '') === orderSn);
        const income = match ? extractIncome(match) : (single ?? (rows[0] ? extractIncome(rows[0]) : null));
        if (income) {
          // Kunci map memakai nomor pesanan yang diminta supaya pemanggil
          // selalu menemukan hasilnya, mesmo kalau Shopee tidak echoing order_sn.
          result.set(orderSn, income);
        } else {
          logger.info(
            `Rincian biaya (escrow): Shopee tidak mengirim rincian untuk ${orderSn}. ` +
              `Bentuk respons: ${describeShape(res)}`,
          );
        }
      } catch (err) {
        logger.warn(`Ambil rincian biaya (escrow) gagal untuk ${orderSn}: ${(err as Error).message}`);
        continue;
      }
    }
    return result;
  }

  async getProducts(creds: ShopCredentials): Promise<MarketplaceProduct[]> {
    const cfg = await this.cfg();

    // Step 1: get all item IDs using GET with multiple item_status
    const itemIds: string[] = [];
    let offset = 0;
    const hasMore = true;

    while (hasMore && offset < 5000) {
      const res = await callShopee<Record<string, unknown>>(
        cfg,
        '/api/v2/product/get_item_list',
        {
          method: 'GET',
          params: {
            offset,
            page_size: 50,
            item_status: ['NORMAL', 'UNLIST', 'BANNED'],
          },
        },
        { shopId: creds.shopId, accessToken: creds.accessToken },
      );
      const list =
        (res?.item as Array<Record<string, unknown>>) ??
        (res?.item_list as Array<Record<string, unknown>>) ??
        [];

      for (const it of list) {
        if (it.item_id) itemIds.push(String(it.item_id));
      }

      const hasNext = Boolean(res?.has_next_page ?? res?.has_next_item);
      if (!hasNext || list.length === 0) {
        break;
      }
      offset += list.length;
    }

    if (itemIds.length === 0) {
      logger.info('Shopee getProducts: tidak ada produk di toko ini', { shopId: creds.shopId });
      return [];
    }
    logger.info(`Shopee: ditemukan ${itemIds.length} produk, mengambil detail + model...`, { shopId: creds.shopId });

    // Step 2: get_item_base_info in batches of 50 via GET
    const products: MarketplaceProduct[] = [];
    for (let i = 0; i < itemIds.length; i += 50) {
      const batch = itemIds.slice(i, i + 50);
      const res = await callShopee<Record<string, unknown>>(
        cfg,
        '/api/v2/product/get_item_base_info',
        {
          method: 'GET',
          params: {
            item_id_list: batch.join(','),
          },
        },
        { shopId: creds.shopId, accessToken: creds.accessToken },
      );
      const list = (res?.item_list as Array<Record<string, unknown>>) ?? [];

      for (const it of list) {
        const itemId = String(it.item_id ?? '');
        const itemName = String(it.item_name ?? '');
        const rawSku = String(it.item_sku ?? '').trim();
        const itemSku = rawSku || `SHOPEE-${itemId}`;

        // Price handling: Shopee price_info is an array of objects
        const priceArr = Array.isArray(it.price_info) ? it.price_info : [];
        const firstPrice = priceArr[0] as Record<string, unknown> | undefined;
        const basePrice =
          firstPrice?.current_price != null
            ? Number(firstPrice.current_price)
            : firstPrice?.original_price != null
              ? Number(firstPrice.original_price)
              : it.price != null
                ? Number(it.price)
                : null;

        const imageObj = (it.image ?? {}) as Record<string, unknown>;
        const imageUrl = (imageObj.image_url_list as string[])?.[0] ?? null;

        // Check if item has models (variants)
        const hasModel = Boolean(it.has_model);

        if (hasModel) {
          // Step 3: get_model_list for items with variants
          const modelVariants = await this.fetchModelVariants(cfg, creds, itemId);
          products.push({
            externalProductId: itemId,
            name: itemName,
            sku: itemSku,
            price: basePrice,
            imageUrl,
            variants:
              modelVariants.length > 0
                ? modelVariants
                : [
                    {
                      externalVariantId: itemId,
                      sku: itemSku,
                      name: itemName,
                      price: basePrice,
                      stock: null,
                    },
                  ],
          });
        } else {
          // Single-variant item — treat item itself as the only variant
          const stock = (it.stock_info_v2 as Record<string, unknown>)?.summary_info as Record<string, unknown> | undefined;
          const stockQty = stock
            ? Number(stock.total_available_stock ?? stock.total_reserved_stock ?? 0)
            : null;
          products.push({
            externalProductId: itemId,
            name: itemName,
            sku: itemSku,
            price: basePrice,
            imageUrl,
            variants: [
              {
                externalVariantId: itemId,
                sku: itemSku,
                name: itemName,
                price: basePrice,
                stock: stockQty,
              },
            ],
          });
        }
      }
    }
    return products;
  }

  /** Fetch model (variant) list for a single item via HTTP GET. */
  private async fetchModelVariants(
    cfg: ShopeeConfig,
    creds: ShopCredentials,
    itemId: string,
  ): Promise<MarketplaceProductVariant[]> {
    try {
      const res = await callShopee<Record<string, unknown>>(
        cfg,
        '/api/v2/product/get_model_list',
        {
          method: 'GET',
          params: { item_id: itemId },
        },
        { shopId: creds.shopId, accessToken: creds.accessToken },
      );
      const models = (res?.model as Array<Record<string, unknown>>) ?? [];
      return models.map((m) => {
        const priceArr = Array.isArray(m.price_info) ? m.price_info : [];
        const priceInfo = (priceArr[0] ?? {}) as Record<string, unknown>;
        const stockArr = Array.isArray(m.stock_info) ? m.stock_info : [];
        const stockInfo = (stockArr[0] ?? {}) as Record<string, unknown>;
        const modelId = String(m.model_id ?? '');
        const rawSku = String(m.model_sku ?? '').trim();
        const modelSku = rawSku || `SHOPEE-${itemId}-${modelId}`;

        return {
          externalVariantId: modelId,
          sku: modelSku,
          name: String(m.model_name ?? ''),
          price:
            priceInfo.current_price != null
              ? Number(priceInfo.current_price)
              : priceInfo.original_price != null
                ? Number(priceInfo.original_price)
                : null,
          stock:
            stockInfo.current_stock != null
              ? Number(stockInfo.current_stock)
              : stockInfo.normal_stock != null
                ? Number(stockInfo.normal_stock)
                : null,
        };
      });
    } catch (err) {
      logger.warn(`Gagal ambil model untuk item ${itemId}: ${(err as Error).message}`);
      return [];
    }
  }

  // ── Stock Update ──────────────────────────────────────────────────────────

  /**
   * Update stock for a single variant in Shopee.
   * Uses HTTP POST: /api/v2/product/update_stock.
   */
  async updateStock(
    creds: ShopCredentials,
    externalVariantId: string,
    quantity: number,
    externalProductId?: string,
  ): Promise<boolean> {
    const cfg = await this.cfg();
    const modelId = Number(externalVariantId);
    const itemId = externalProductId ? Number(externalProductId) : null;

    if (!itemId) {
      logger.warn('updateStock: externalProductId diperlukan untuk update stok Shopee', {
        externalVariantId,
        quantity,
      });
      return false;
    }

    try {
      const stockList = [{ model_id: modelId, normal_stock: quantity }];
      await callShopee<Record<string, unknown>>(
        cfg,
        '/api/v2/product/update_stock',
        {
          method: 'POST',
          body: { item_id: itemId, stock_list: stockList },
        },
        { shopId: creds.shopId, accessToken: creds.accessToken },
      );
      logger.info('updateStock berhasil', { itemId, modelId, quantity, shopId: creds.shopId });
      return true;
    } catch (err) {
      logger.error('updateStock gagal', { error: (err as Error).message, externalVariantId, quantity });
      return false;
    }
  }

  // ── Returns ───────────────────────────────────────────────────────────────

  /**
   * Fetch return list from Shopee via HTTP GET.
   * Uses: /api/v2/returns/get_return_list.
   */
  async getReturns(creds: ShopCredentials): Promise<MarketplaceReturn[]> {
    const cfg = await this.cfg();
    const all: MarketplaceReturn[] = [];
    let pageNo = 0;
    let hasMore = true;

    while (hasMore) {
      const res = await callShopee<Record<string, unknown>>(
        cfg,
        '/api/v2/returns/get_return_list',
        {
          method: 'GET',
          params: { page_no: pageNo, page_size: 50 },
        },
        { shopId: creds.shopId, accessToken: creds.accessToken },
      );
      const list = (res?.return as Array<Record<string, unknown>>) ?? [];
      for (const r of list) {
        const mapped = this.mapReturn(r);
        if (mapped) all.push(mapped);
      }
      hasMore = (res?.more as boolean) === true;
      pageNo++;
      if (!hasMore || list.length === 0) break;
    }
    return all;
  }

  private mapReturn(r: Record<string, unknown>): MarketplaceReturn | null {
    const returnSn = typeof r.return_sn === 'string' ? r.return_sn : null;
    const orderSn = typeof r.order_sn === 'string' ? r.order_sn : null;
    if (!returnSn || !orderSn) return null;

    const itemsRaw = (r.item as Array<Record<string, unknown>>) ?? [];
    return {
      externalReturnId: returnSn,
      externalOrderId: orderSn,
      status: String(r.status ?? ''),
      reason: String(r.reason ?? ''),
      items: itemsRaw.map((it) => ({
        externalItemId: String(it.item_id ?? ''),
        externalVariantId: String(it.model_id ?? it.item_id ?? ''),
        sku: String(it.item_sku ?? ''),
        name: String(it.item_name ?? ''),
        quantity: Number(it.amount ?? 1),
      })),
      createdAt: toDate(r.create_time) ?? new Date(),
    };
  }

  // ── Tracking ──────────────────────────────────────────────────────────────

  /** Fetch the AWB (nomor resi) for an order via /api/v2/logistics/get_tracking_number. */
  async getTrackingNumber(creds: ShopCredentials, orderSn: string, packageNumber?: string): Promise<string | null> {
    const cfg = await this.cfg();
    try {
      const params: Record<string, string> = { order_sn: orderSn };
      if (packageNumber) params.package_number = packageNumber;
      const res = await callShopee<Record<string, unknown>>(
        cfg,
        '/api/v2/logistics/get_tracking_number',
        { method: 'GET', params },
        { shopId: creds.shopId, accessToken: creds.accessToken },
      );
      const tn = res?.tracking_number as string | undefined;
      return tn || null;
    } catch (err) {
      logger.warn(`getTrackingNumber gagal untuk order ${orderSn}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Fetch tracking info via /api/v2/logistics/get_tracking_info.
   * Real Shopee v2 API returns:
   *   response.logistics_status — overall logistics status
   *   response.tracking_info   — array of tracking events
   *     each: { update_time, description, logistics_status, return_code }
   * AWB is obtained separately via get_tracking_number.
   */
  async getTrackingInfo(creds: ShopCredentials, orderSn: string, packageNumber?: string): Promise<TrackingInfo | null> {
    const cfg = await this.cfg();
    try {
      const params: Record<string, string> = { order_sn: orderSn };
      if (packageNumber) params.package_number = packageNumber;
      const res = await callShopee<Record<string, unknown>>(
        cfg,
        '/api/v2/logistics/get_tracking_info',
        { method: 'GET', params },
        { shopId: creds.shopId, accessToken: creds.accessToken },
      );
      if (!res) return null;

      // Fetch AWB: check if already in response, or call get_tracking_number
      const awb = (res.tracking_number as string) ?? (await this.getTrackingNumber(creds, orderSn, packageNumber));

      // Real Shopee v2 returns `tracking_info`; fallback to `tracking_list`
      const trackingEvents =
        (res.tracking_info as Array<Record<string, unknown>>) ??
        (res.tracking_list as Array<Record<string, unknown>>) ??
        [];
      const overallStatus = String(res.logistics_status ?? '');
      const carrier = String(res.logistics_channel_name ?? res.shipping_carrier ?? '');

      return {
        awb: awb ?? orderSn, // fallback to orderSn if AWB not yet assigned
        carrier,
        status: overallStatus,
        events: trackingEvents.map((e, idx) => {
          const timestamp = typeof e.update_time === 'number' ? e.update_time : typeof e.event_time === 'number' ? e.event_time : null;
          return {
            externalEventId: String(e.logistics_event_id ?? e.update_time ?? idx),
            status: String(e.logistics_status ?? e.status ?? ''),
            description: String(e.description ?? ''),
            occurredAt: timestamp !== null ? new Date(timestamp * 1000) : new Date(),
          };
        }),
      };
    } catch (err) {
      logger.warn(`getTrackingInfo gagal untuk order ${orderSn}: ${(err as Error).message}`);
      return null;
    }
  }

  // ── Arrange Shipment ────────────────────────────────────────────────────────

  /**
   * Mengatur pengiriman ("Atur Pengiriman") untuk pesanan Shopee.
   * Endpoint: POST /api/v2/logistics/ship_order
   *
   * Flow Shopee OpenAPI v2 (WAJIB urut, jangan dilewati):
   * 1. Order status: READY_TO_SHIP
   * 2. get_shipping_parameter → channel yang benar-benar DIDUKUNG pesanan ini
   * 3. ship_order dengan channel itu (pickup ATAU dropoff — bukan asal kirim dropoff)
   * 4. get_tracking_number → AWB
   *
   * Langkah 2 tidak boleh dilewati: mengirim `dropoff: {}` tanpa memeriksa
   * dukungan Shopee menghasilkan `logistics.ship_order_unsupport_dropoff` dan
   * operator tidak punya cara memperbaikinya sendiri.
   */
  async arrangeShipment(creds: ShopCredentials, input: ArrangeShipmentInput): Promise<ArrangeShipmentResult> {
    const cfg = await this.cfg();
    try {
      // 1) Tanya Shopee channel apa yang didukung pesanan ini.
      const paramRes = await callShopee<unknown>(
        cfg,
        '/api/v2/logistics/get_shipping_parameter',
        {
          // WAJIB GET + query param, bukan POST + body.
          // Dikonfirmasi langsung di Shopee API Test Tool
          // (Partner 1245182 -> Logistics -> v2.logistics.get_shipping_parameter):
          //   "Http Method: GET" dengan Request Parameters `order_sn` dan
          //   `package_number` (keduanya bertanda wajib `*`).
          //
          // Bentuk POST + body `{ order_list: [...] }` dijawab sandbox
          // dengan `HTTP 404 page not found`, bukan error Shopee yang jelas.
          // Karena itu aplikasi diam-diam jatuh ke `dropoff: {}` dan gagal dengan
          // `ship_order_unsupport_dropoff`.
          method: 'GET',
          params: {
            order_sn: input.orderSn,
            // Tanpa `package_number`, Shopee menjawab
            // `logistics.package_not_exist` karena paketnya tidak bisa ditemukan.
            ...(input.packageNumber ? { package_number: input.packageNumber } : {}),
          },
        },
        { shopId: creds.shopId, accessToken: creds.accessToken },
      );
      const channels = extractSupportedChannels(paramRes);
      if (channels.length === 0) {
        logger.warn(`Tidak ada kanal pengiriman yang didukung untuk order ${input.orderSn}`, {
          shopId: creds.shopId,
        });
        throw describeNoChannel(input.orderSn);
      }
      const channel = pickChannel(channels, {
        pickupTimeId: input.pickupTimeId ?? null,
        // `branchId` di kontrak bertipe number (dari get_branch_list), sedangkan
        // Shopee mengirim id kanal sebagai string. Semuanya dinormalkan ke string
        // supaya perbandingan tidak pernah gagal diam-diam.
        branchId: input.branchId === undefined || input.branchId === null
          ? null
          : String(input.branchId),
      });
      if (!channel) throw describeNoChannel(input.orderSn);

      // 2) Kirim hanya channel yang Shopee dukung.
      const body: Record<string, unknown> = { order_sn: input.orderSn };
      if (input.packageNumber) body.package_number = input.packageNumber;
      if (channel.kind === 'pickup') {
        body.pickup = { pickup_time_id: channel.pickupTimeId };
      } else {
        body.dropoff = channel.branchId ? { branch_id: channel.branchId } : {};
      }

      await callShopee<Record<string, unknown>>(
        cfg,
        '/api/v2/logistics/ship_order',
        { method: 'POST', body },
        { shopId: creds.shopId, accessToken: creds.accessToken },
      );

      // 3) Setelah `ship_order` diterima, ambil nomor resi. Resi WAJIB ada sebelum
      // dianggap berhasil — kalau Shopee belum menerbitkannya, kembalikan
      // kegagalan apa adanya supaya operator tahu harus mencoba lagi.
      const trackingNumber = await this.getTrackingNumber(creds, input.orderSn);
      if (!trackingNumber) {
        const msg =
          'Shopee sudah menerima permintaan pengiriman, tetapi nomor resi belum terbit. Coba lagi beberapa saat lagi.';
        logger.warn(`arrangeShipment tanpa AWB untuk order ${input.orderSn}: ${msg}`);
        return { success: false, trackingNumber: null, message: msg };
      }

      logger.info(`arrangeShipment berhasil: order ${input.orderSn}, kanal ${channel.kind}, AWB ${trackingNumber}`, {
        shopId: creds.shopId,
      });
      return { success: true, trackingNumber };
    } catch (err) {
      const msg = (err as Error).message;
      logger.error(`arrangeShipment gagal untuk order ${input.orderSn}: ${msg}`, { shopId: creds.shopId });
      return { success: false, trackingNumber: null, message: msg };
    }
  }

  // ── Shipping document / label (alur resmi Shopee, 4 langkah) ──────────────
  // Dokumentasi: get_shipping_document_parameter → create_shipping_document
  // → get_shipping_document_result → download_shipping_document.
  // Format label SELALU diambil dari Shopee (tidak di-hardcode), dan file label
  // yang ditampilkan adalah file yang Shopee terbitkan — tanpa modifikasi.
  // Detail & sumber: domain/shipping-document.ts.

  /** Langkah 1: format label yang valid untuk paket-paket ini. */
  async getShippingDocumentParameters(
    creds: ShopCredentials,
    targets: LabelTarget[],
  ): Promise<DocumentParameter[]> {
    const cfg = await this.cfg();
    return getDocumentParameters(cfg, creds, targets);
  }

  /** Langkah 2: buat task pembuatan label (butuh resi). */
  async createShippingDocument(
    creds: ShopCredentials,
    target: LabelTarget,
    documentType: ShippingDocumentType,
  ): Promise<void> {
    const cfg = await this.cfg();
    await createDocument(cfg, creds, target, documentType);
  }

  /** Langkah 3: status task label; hanya READY yang boleh diunduh. */
  async getShippingDocumentResult(
    creds: ShopCredentials,
    target: LabelTarget,
    documentType: ShippingDocumentType,
  ): Promise<DocumentTask> {
    const cfg = await this.cfg();
    return getDocumentResult(cfg, creds, target, documentType);
  }

  /** Langkah 4: unduh file label resmi dari Shopee. */
  async downloadShippingDocument(
    creds: ShopCredentials,
    target: LabelTarget,
    documentType: ShippingDocumentType,
  ): Promise<DownloadedLabel> {
    const cfg = await this.cfg();
    return downloadDocument(cfg, creds, target, documentType);
  }

  /**
   * Alur lengkap sekali jalan: pilih format dari Shopee → buat task → tunggu
   * READY → unduh. Mengembalikan file label asli.
   * Error Shopee diteruskan apa adanya (tidak ditelan, tidak dikarang).
   */
  async fetchOfficialShippingLabel(
    creds: ShopCredentials,
    target: LabelTarget,
  ): Promise<{ label: DownloadedLabel; documentType: ShippingDocumentType }> {
    const [param] = await this.getShippingDocumentParameters(creds, [target]);
    if (!param) {
      throw new ExternalIntegrationError(
        'shopee',
        `Shopee tidak mengembalikan informasi label untuk pesanan ${target.orderSn}.`,
      );
    }
    if (param.failError) {
      throw new ExternalIntegrationError('shopee', describeLabelFailure(param, target), {
        providerCode: param.failError,
        target,
      });
    }
    const documentType = param.suggestedType ?? param.selectableTypes[0] ?? null;
    if (!documentType) {
      throw new ExternalIntegrationError('shopee', describeLabelFailure(param, target));
    }
    // `THERMAL_UNPACKAGED_LABEL` memakai alur job khusus Shopee
    // (create job → status job → download job), bukan rantai 549→547→561→548.
    // Mengirimnya lewat rantai normal akan gagal diam-diam, jadi tolong dengan
    // pesan yang bisa ditindaklanjuti, bukan diamkan.
    if (documentType === 'THERMAL_UNPACKAGED_LABEL') {
      throw new ExternalIntegrationError(
        'shopee',
        `Kanal untuk pesanan ${target.orderSn} memakai label tanpa kemasan (THERMAL_UNPACKAGED_LABEL), ` +
          'yang membutuhkan alur job khusus Shopee dan belum didukung aplikasi ini. ' +
          'Selesaikan Pencetakan dari Seller Centre atau hubungi Shopee.',
        { target, documentType },
      );
    }
    assertHasTrackingNumber(target);
    await this.createShippingDocument(creds, target, documentType);
    const task = await pollUntilReady(() => this.getShippingDocumentResult(creds, target, documentType));
    if (task.failError || task.failMessage) {
      throw new ExternalIntegrationError(
        'shopee',
        `Shopee belum bisa menyiapkan label untuk pesanan ${target.orderSn}: ${task.failMessage ?? task.failError}.`,
        { providerCode: task.failError, target },
      );
    }
    if (task.status !== 'READY') {
      throw new ExternalIntegrationError(
        'shopee',
        `Label untuk pesanan ${target.orderSn} belum siap (status: ${task.status}).` +
          ' Coba lagi beberapa saat lagi.',
        { target, status: task.status },
      );
    }
    const label = await this.downloadShippingDocument(creds, target, documentType);
    return { label, documentType };
  }

  // ── Webhook ───────────────────────────────────────────────────────────────

  /**
   * Verify a Shopee webhook push signature.
   * Algorithm (verified from official docs §2.2):
   *   HMAC-SHA256(url + "|" + raw_body, partner_key) → lowercase hex
   *   Value is in HTTP header "Authorization".
   */
  verifyWebhookSignature(url: string, rawBody: string, signature: string, partnerKey: string): boolean {
    const expected = crypto
      .createHmac('sha256', partnerKey)
      .update(`${url}|${rawBody}`)
      .digest('hex');
    // Use timing-safe comparison to prevent timing attacks
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature.toLowerCase()));
    } catch {
      // Buffers of different length throw — means signature is wrong
      return false;
    }
  }
}
