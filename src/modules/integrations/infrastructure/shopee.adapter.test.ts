import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import { ShopeeAdapter, signShopee, mapShopeeOrderStatus } from './shopee.adapter';
import { invalidateShopeeAppConfigCache } from '../application/appConfig.service';
import type { ShopCredentials } from '../domain/marketplace.adapter';

// Unit test harus hermetis: konfigurasi partner selalu diambil dari .env (bukan DB).
vi.mock('@/shared/infrastructure/prisma', () => ({
  prisma: {
    marketplaceAppConfig: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}));

describe('ShopeeAdapter', () => {
  const originalEnv = { ...process.env };
  const adapter = new ShopeeAdapter();

  const partnerId = '123456';
  const partnerKey = 'test_partner_key_abc123';
  const shopId = '227924374';
  const accessToken = 'test_access_token_xyz';

  beforeEach(() => {
    process.env.SHOPEE_PARTNER_ID = partnerId;
    process.env.SHOPEE_PARTNER_KEY = partnerKey;
    process.env.SHOPEE_API_HOST = 'https://partner.shopeemobile.com';
    process.env.SHOPEE_SANDBOX = 'true';
    process.env.SHOPEE_SANDBOX_HOST = 'https://partner.test-stable.shopeemobile.com';
    invalidateShopeeAppConfigCache();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    invalidateShopeeAppConfigCache();
    vi.restoreAllMocks();
  });

  describe('signShopee', () => {
    it('generates correct HMAC-SHA256 signature for Shop API (with accessToken & shopId)', () => {
      const apiPath = '/api/v2/order/get_order_list';
      const timestamp = 1710000000;
      const baseString = `${partnerId}${apiPath}${timestamp}${accessToken}${shopId}`;
      const expectedSign = crypto
        .createHmac('sha256', partnerKey)
        .update(baseString)
        .digest('hex');

      const sign = signShopee(partnerId, partnerKey, apiPath, timestamp, accessToken, shopId);
      expect(sign).toBe(expectedSign);
    });

    it('generates correct HMAC-SHA256 signature for Public API (without accessToken & shopId)', () => {
      const apiPath = '/api/v2/auth/token/get';
      const timestamp = 1710000000;
      const baseString = `${partnerId}${apiPath}${timestamp}`;
      const expectedSign = crypto
        .createHmac('sha256', partnerKey)
        .update(baseString)
        .digest('hex');

      const sign = signShopee(partnerId, partnerKey, apiPath, timestamp);
      expect(sign).toBe(expectedSign);
    });

    /**
     * Regresi untuk `get_escrow_detail_batch` yang selalu gagal sehingga kartu
     * "Potongan Shopee" dan "Estimasi dana masuk" tidak pernah muncul.
     *
     * Bukti error produksi (Shopee menolak kombinasi parameter yang salah):
     *   - tanpa `shop_id`      → "There is no shop_id in query"
     *   - tanpa `access_token` → "There is no access_token in query"
     *   - signature app-level   → "error_sign"
     * Artinya endpoint ini WAJIB scope `shop` (access_token + shop_id).
     */
    it('get_escrow_detail_batch wajib memakai scope shop (accessToken + shopId)', () => {
      const apiPath = '/api/v2/payment/get_escrow_detail_batch';
      const timestamp = 1710000000;
      const shopScope = crypto
        .createHmac('sha256', partnerKey)
        .update(`${partnerId}${apiPath}${timestamp}${accessToken}${shopId}`)
        .digest('hex');
      const appScope = crypto
        .createHmac('sha256', partnerKey)
        .update(`${partnerId}${apiPath}${timestamp}`)
        .digest('hex');

      // Scope shop = kombinasi yang Shopee terima.
      expect(signShopee(partnerId, partnerKey, apiPath, timestamp, accessToken, shopId, 'shop')).toBe(
        shopScope,
      );
      // Scope app menghasilkan signature berbeda → memicu "error_sign".
      expect(signShopee(partnerId, partnerKey, apiPath, timestamp, accessToken, shopId, 'app')).toBe(
        appScope,
      );
      expect(appScope).not.toBe(shopScope);
    });
  });

  describe('verifyWebhookSignature', () => {
    it('returns true when webhook signature matches HMAC-SHA256(url + "|" + rawBody)', () => {
      const url = 'https://myapp.com/api/v1/integrations/shopee/webhook';
      const rawBody = JSON.stringify({ code: 3, shop_id: 227924374, data: { ordersn: '240321ABC' } });
      const validSignature = crypto
        .createHmac('sha256', partnerKey)
        .update(`${url}|${rawBody}`)
        .digest('hex');

      const isValid = adapter.verifyWebhookSignature(url, rawBody, validSignature, partnerKey);
      expect(isValid).toBe(true);
    });

    it('returns false when signature does not match or body was altered', () => {
      const url = 'https://myapp.com/api/v1/integrations/shopee/webhook';
      const rawBody = JSON.stringify({ code: 3, shop_id: 227924374 });
      const invalidSignature = 'deadbeef12345678deadbeef12345678deadbeef12345678deadbeef12345678';

      const isValid = adapter.verifyWebhookSignature(url, rawBody, invalidSignature, partnerKey);
      expect(isValid).toBe(false);
    });
  });

  describe('buildAuthUrl', () => {
    it('builds sandbox authorization URL when SHOPEE_SANDBOX is true', async () => {
      process.env.SHOPEE_SANDBOX = 'true';
      const redirectUri = 'http://localhost:3000/api/v1/integrations/shopee/oauth-callback';
      const url = await adapter.buildAuthUrl(redirectUri, 'shop-123');

      expect(url).toContain('https://partner.test-stable.shopeemobile.com/api/v2/shop/auth_partner');
      expect(url).toContain(`partner_id=${partnerId}`);
      expect(url).toContain('state=shop-123');
      expect(url).toContain('sign=');
      expect(url).toContain('timestamp=');
    });

    it('builds production authorization URL when SHOPEE_SANDBOX is false', async () => {
      process.env.SHOPEE_SANDBOX = 'false';
      const redirectUri = 'https://myapp.com/callback';
      const url = await adapter.buildAuthUrl(redirectUri);

      expect(url).toContain('https://partner.shopeemobile.com/api/v2/shop/auth_partner');
      expect(url).toContain(`partner_id=${partnerId}`);
      expect(url).toContain('sign=');
    });
  });

  describe('mapShopeeOrderStatus', () => {
    it('passes through raw status string', () => {
      expect(mapShopeeOrderStatus('READY_TO_SHIP')).toBe('READY_TO_SHIP');
      expect(mapShopeeOrderStatus('COMPLETED')).toBe('COMPLETED');
    });
  });

  describe('API error & non-JSON handling', () => {
    const creds: ShopCredentials = {
      shopId,
      accessToken,
      partnerId,
      partnerKey,
    };

    it('handles non-JSON response gracefully without crashing with JSON parse error', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 502,
        text: async () => '<html><body>Bad Gateway</body></html>',
      });

      await expect(adapter.getOrderDetail(creds, 'ORDER123')).rejects.toThrow(
        /Shopee API mengembalikan response tidak valid/,
      );
    });

    it('throws Shopee API error message when error field is present', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        text: async () =>
          JSON.stringify({
            error: 'error_auth',
            message: 'Invalid access token',
            request_id: 'req_12345',
          }),
      });

      await expect(adapter.getOrderDetail(creds, 'ORDER123')).rejects.toThrow(
        /Shopee API error \[error_auth\] pada \/api\/v2\/order\/get_order_detail: Invalid access token/,
      );
    });
  });

  describe('mapOrder', () => {
    it('correctly maps Shopee order detail response to MarketplaceOrder structure', async () => {
      const creds: ShopCredentials = {
        shopId,
        accessToken,
        partnerId,
        partnerKey,
      };

      const mockShopeeOrder = {
        order_sn: '240921ORDER001',
        order_status: 'READY_TO_SHIP',
        create_time: 1710000000,
        ship_by_date: 1710100000,
        buyer_username: 'buyer_shopee_01',
        shipping_carrier: 'J&T Express',
        recipient_address: {
          name: 'Budi Santoso',
          phone: '08123456789',
          full_address: 'Jl. Merdeka No. 10',
          city: 'Jakarta Selatan',
          district: 'Kebayoran Baru',
          state: 'DKI Jakarta',
          zipcode: '12110',
        },
        package_list: [
          {
            tracking_number: 'SPXID0123456789',
            shipping_carrier: 'Shopee Xpress',
          },
        ],
        item_list: [
          {
            item_id: 111111,
            model_id: 222222,
            item_sku: 'KAOS-BASE',
            model_sku: 'KAOS-S',
            model_name: 'Kaos Polos Hitam - Size S',
            model_quantity_purchased: 2,
            model_discounted_price: 75000,
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        text: async () =>
          JSON.stringify({
            response: {
              order_list: [mockShopeeOrder],
            },
          }),
      });

      const order = await adapter.getOrderDetail(creds, '240921ORDER001');
      expect(order).not.toBeNull();
      expect(order?.externalOrderId).toBe('240921ORDER001');
      expect(order?.rawStatus).toBe('READY_TO_SHIP');
      expect(order?.buyerName).toBe('buyer_shopee_01');
      expect(order?.buyerPhone).toBe('08123456789');
      expect(order?.trackingNumber).toBe('SPXID0123456789');
      expect(order?.carrier).toBe('Shopee Xpress');
      expect(order?.items).toHaveLength(1);
      expect(order?.items[0]).toEqual({
        externalItemId: '111111',
        externalVariantId: '222222',
        sku: 'KAOS-S',
        name: 'Kaos Polos Hitam - Size S',
        quantity: 2,
        unitPrice: 75000,
      });
    });
  });

  describe('getReturns', () => {
    it('fetches and maps Shopee return list to MarketplaceReturn structure', async () => {
      const creds: ShopCredentials = {
        shopId,
        accessToken,
        partnerId,
        partnerKey,
      };

      const mockShopeeReturn = {
        return_sn: 'RET240921001',
        order_sn: '240921ORDER001',
        status: 'REQUESTED',
        reason: 'Item defective',
        create_time: 1710005000,
        item: [
          {
            item_id: 111111,
            model_id: 222222,
            item_sku: 'KAOS-S',
            item_name: 'Kaos Polos Hitam - Size S',
            amount: 1,
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        text: async () =>
          JSON.stringify({
            response: {
              return: [mockShopeeReturn],
              more: false,
            },
          }),
      });

      const returns = await adapter.getReturns(creds);
      expect(returns).toHaveLength(1);
      expect(returns[0]?.externalReturnId).toBe('RET240921001');
      expect(returns[0]?.externalOrderId).toBe('240921ORDER001');
      expect(returns[0]?.status).toBe('REQUESTED');
      expect(returns[0]?.reason).toBe('Item defective');
      expect(returns[0]?.items).toHaveLength(1);
      expect(returns[0]?.items[0]?.quantity).toBe(1);
    });
  });

  describe('getTrackingInfo', () => {
    it('fetches and maps logistics tracking info', async () => {
      const creds: ShopCredentials = {
        shopId,
        accessToken,
        partnerId,
        partnerKey,
      };

      const mockTracking = {
        tracking_number: 'SPX1234567890',
        logistics_channel_name: 'Shopee Xpress',
        logistics_status: 'LOGISTICS_PICKUP_DONE',
        tracking_list: [
          {
            logistics_event_id: 'EVT001',
            status: 'PICKUP_DONE',
            description: 'Paket telah diserahkan ke kurir',
            event_time: 1710001000,
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
        text: async () =>
          JSON.stringify({
            response: mockTracking,
          }),
      });

      const tracking = await adapter.getTrackingInfo(creds, '240921ORDER001');
      expect(tracking).not.toBeNull();
      expect(tracking?.awb).toBe('SPX1234567890');
      expect(tracking?.carrier).toBe('Shopee Xpress');
      expect(tracking?.status).toBe('LOGISTICS_PICKUP_DONE');
      expect(tracking?.events).toHaveLength(1);
      expect(tracking?.events[0]?.description).toBe('Paket telah diserahkan ke kurir');
    });
  });

  describe('arrangeShipment', () => {
    const creds: ShopCredentials = {
      shopId,
      accessToken,
      partnerId,
      partnerKey,
    };

    /**
     * Regresi untuk `ship_order_unsupport_dropoff`.
     *
     * Bukti produksi (Shopee API Test Tool, Partner 1245182 → Logistics):
     *   `v2.logistics.get_shipping_parameter`
     *     - Http Method: **GET**
     *     - Request Parameters wajib: `order_sn`, `package_number`
     *
     * Versi lama memakai POST + body `{ order_list: [...] }` → sandbox menjawab
     * `HTTP 404 page not found`; karena 0 channel terbaca, aplikasi jatuh ke
     * `dropoff: {}` dan gagal dengan `logistics.ship_order_unsupport_dropoff`.
     */
    it('memakai GET + order_sn + package_number untuk get_shipping_parameter', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          status: 200,
          text: async () => JSON.stringify({ error: '', message: '', response: {} }),
        })
        .mockResolvedValue({
          status: 200,
          text: async () => JSON.stringify({ error: '', message: '', response: {} }),
        });
      global.fetch = fetchMock;

      await adapter
        .arrangeShipment(creds, {
          orderSn: '2609251DP1HPAW',
          packageNumber: 'OFG244049059201461',
        })
        .catch(() => undefined);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/api/v2/logistics/get_shipping_parameter');
      expect(init.method).toBe('GET');
      expect(url).toContain('order_sn=2609251DP1HPAW');
      expect(url).toContain('package_number=OFG244049059201461');
    });

    it('menanyakan kanal ke Shopee dulu, lalu kirim ship_order sesuai kanal yang didukung', async () => {
      const fetchMock = vi
        .fn()
        // 1st call: get_shipping_parameter → Shopee hanya mendukung dropoff ini.
        .mockResolvedValueOnce({
          status: 200,
          text: async () =>
            JSON.stringify({
              error: '',
              message: '',
              response: {
                shipping_document_list: [{ dropoff_branch_list: [{ branch_id: 'BR-77' }] }],
              },
            }),
        })
        // 2nd call: ship_order
        .mockResolvedValueOnce({
          status: 200,
          text: async () => JSON.stringify({ error: '', message: '', response: {} }),
        })
        // 3rd call: get_tracking_number
        .mockResolvedValueOnce({
          status: 200,
          text: async () =>
            JSON.stringify({
              error: '',
              message: '',
              response: { tracking_number: 'SPX9988776655' },
            }),
        });

      global.fetch = fetchMock;

      const result = await adapter.arrangeShipment(creds, { orderSn: '240921ORDER001' });

      expect(result.success).toBe(true);
      expect(result.trackingNumber).toBe('SPX9988776655');

      // Langkah 1: wajib menanyakan kanal lebih dulu (anti ship_order_unsupport_dropoff).
      // Kontrak resmi: GET + query param, bukan POST + body.
      const [paramUrl, paramInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(paramUrl).toContain('/api/v2/logistics/get_shipping_parameter');
      expect(paramInit.method).toBe('GET');
      expect(paramUrl).toContain('order_sn=240921ORDER001');

      // Langkah 2: ship_order memakai kanal yang Shopee dukung, lengkap dengan branch_id.
      const [shipUrl, shipInit] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(shipUrl).toContain('/api/v2/logistics/ship_order');
      expect(shipInit.method).toBe('POST');
      const body = JSON.parse(shipInit.body as string);
      expect(body.order_sn).toBe('240921ORDER001');
      expect(body.dropoff).toEqual({ branch_id: 'BR-77' });
      expect(body.pickup).toBeUndefined();

      // Langkah 3: ambil nomor resi.
      const [trackUrl, trackInit] = fetchMock.mock.calls[2] as [string, RequestInit];
      expect(trackUrl).toContain('/api/v2/logistics/get_tracking_number');
      expect(trackInit.method).toBe('GET');
      expect(trackUrl).toContain('order_sn=240921ORDER001');
    });

    it('menolak dengan pesan jelas saat Shopee tidak mendukung kanal apa pun (tidak asal kirim dropoff)', async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({
        status: 200,
        text: async () => JSON.stringify({ error: '', message: '', response: { shipping_document_list: [{}] } }),
      });

      global.fetch = fetchMock;

      const result = await adapter.arrangeShipment(creds, { orderSn: '240921ORDER001' });

      expect(result.success).toBe(false);
      expect(result.trackingNumber).toBeNull();
      expect(result.message).toContain('belum punya kanal pengiriman');
      // ship_order TIDAK boleh dipanggil saat tidak ada kanal yang didukung.
      const calledUrls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(calledUrls.some((u) => u.includes('ship_order'))).toBe(false);
    });
  });

  describe('HTTP Method validation (GET vs POST)', () => {
    const creds: ShopCredentials = {
      shopId,
      accessToken,
      partnerId,
      partnerKey,
    };

    it('uses HTTP GET for getProducts item query', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        text: async () =>
          JSON.stringify({
            response: {
              item: [],
              has_next_page: false,
            },
          }),
      });
      global.fetch = fetchMock;

      await adapter.getProducts(creds);

      expect(fetchMock).toHaveBeenCalled();
      const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(calledInit.method).toBe('GET');
      expect(calledUrl).toContain('/api/v2/product/get_item_list');
      // Parameter list pada Shopee dikirim sebagai JSON, bukan berulang:
      //   item_status=["NORMAL","UNLIST","BANNED"]
      // Bentuk berulang (`item_status=NORMAL&item_status=...`) ditolak Shopee
      // dengan "format should be string[]" (terbukti di error produksi untuk
      // `order_sn_list`).
      expect(calledUrl).toContain(`item_status=${encodeURIComponent('["NORMAL","UNLIST","BANNED"]')}`);
    });

    it('uses HTTP POST with body for updateStock', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        text: async () => JSON.stringify({ response: {} }),
      });
      global.fetch = fetchMock;

      const success = await adapter.updateStock(creds, '222222', 15, '111111');
      expect(success).toBe(true);

      const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(calledInit.method).toBe('POST');
      expect(calledUrl).toContain('/api/v2/product/update_stock');
      const parsedBody = JSON.parse(calledInit.body as string);
      expect(parsedBody).toEqual({
        item_id: 111111,
        stock_list: [{ model_id: 222222, normal_stock: 15 }],
      });
    });
  });
});

