import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExternalIntegrationError } from '@/shared/errors/AppError';
import {
  createDocument,
  downloadDocument,
  getDocumentResult,
} from './shopee-shipping-document.client';
import type { LabelTarget, ShopeeConfig } from '../domain/shipping-document';
import type { ShopCredentials } from '../domain/marketplace.adapter';

const cfg: ShopeeConfig = {
  partnerId: '123456',
  partnerKey: 'partner-test-key',
  apiHost: 'https://partner.example.test',
};

const creds: ShopCredentials = {
  shopId: '227924374',
  accessToken: 'access-token-test',
  partnerId: cfg.partnerId,
  partnerKey: cfg.partnerKey,
};

const target: LabelTarget = {
  orderSn: 'ORDER-1',
  packageNumber: 'PKG-1',
  trackingNumber: 'AWB-1',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Shopee shipping document client — validasi respons per paket', () => {
  it('tidak menganggap result_list kosong sebagai pembuatan label berhasil', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ response: { result_list: [] } })));

    await expect(
      createDocument(cfg, creds, target, 'NORMAL_AIR_WAYBILL'),
    ).rejects.toBeInstanceOf(ExternalIntegrationError);
  });

  it('menolak result_list yang bukan untuk paket target', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ response: { result_list: [{ order_sn: 'ORDER-OTHER', package_number: 'PKG-1' }] } }),
      ),
    );

    await expect(createDocument(cfg, creds, target, 'NORMAL_AIR_WAYBILL')).rejects.toThrow(
      /tidak mengembalikan hasil.*ORDER-1/i,
    );
  });

  it('meneruskan fail_error per paket sebagai error integrasi', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          response: {
            result_list: [
              {
                order_sn: 'ORDER-1',
                package_number: 'PKG-1',
                fail_error: 'logistics.package_print_failed',
                fail_message: 'Paket belum siap dilabeli',
              },
            ],
          },
        }),
      ),
    );

    await expect(createDocument(cfg, creds, target, 'NORMAL_AIR_WAYBILL')).rejects.toThrow(
      /Paket belum siap dilabeli/,
    );
  });

  it('menolak status hasil untuk paket yang berbeda', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ response: { result_list: [{ order_sn: 'ORDER-OTHER', status: 'READY' }] } }),
      ),
    );

    await expect(getDocumentResult(cfg, creds, target, 'NORMAL_AIR_WAYBILL')).rejects.toThrow(
      /tidak mengembalikan status.*ORDER-1/i,
    );
  });
});

describe('Shopee shipping document client — file label harus benar-benar file', () => {
  it('tidak regards JSON error HTTP 200 sebagai label binari', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ error: 'logistics.package_print_failed', message: 'Label belum tersedia' }),
      ),
    );

    await expect(downloadDocument(cfg, creds, target, 'NORMAL_AIR_WAYBILL')).rejects.toBeInstanceOf(
      ExternalIntegrationError,
    );
  });

  it('tidak regards teks proxy/error sebagai file label', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html><body>Bad Gateway</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      ),
    );

    await expect(downloadDocument(cfg, creds, target, 'NORMAL_AIR_WAYBILL')).rejects.toThrow(
      /tidak mengirim file label yang valid/i,
    );
  });

  it('menerima PDF sungguhan berdasarkan magic bytes, bukan header saja', async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(pdf, {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        }),
      ),
    );

    const result = await downloadDocument(cfg, creds, target, 'NORMAL_AIR_WAYBILL');

    expect(result.contentType).toBe('application/pdf');
    expect(result.fileName).toBe('label-ORDER-1-PKG-1.pdf');
    expect(Array.from(result.bytes)).toEqual(Array.from(pdf));
  });
});
