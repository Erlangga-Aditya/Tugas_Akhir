/**
 * Klien 4 langkah label resmi Shopee, terpisah dari adapter agar mudah diuji
 * tanpa menyentuh logika sinkronisasi.
 *
 * Semua nama path, parameter, dan nama field di sini taken dari API dokumentasi
 * resmi Shopee Open Platform v2 (api_id 549 / 547 / 561 / 548), diverifikasi
 * 2026-09 lewat `open.shopee.com/opservice/api/v1/doc/api/?version=2`.
 *
 * Catatan penting: `download_shipping_document` mengembalikan FILE (bukan
 * JSON), jadi ia tidak bisa memakai callShopee() biasa. Karena itu ada helper
 * sendiri di bawah yang menandatangani request lalu mengembalikan raw bytes.
 */

import crypto from 'crypto';
import type { ShopCredentials } from '../domain/marketplace.adapter';
import {
  type DocumentParameter,
  type DocumentTask,
  type DownloadedLabel,
  type LabelTarget,
  type ShippingDocumentType,
  type ShopeeConfig,
  mapDocumentParameter,
  mapDocumentTask,
  resultList,
} from '../domain/shipping-document';
import { ExternalIntegrationError } from '@/shared/errors/AppError';
import { logger } from '@/shared/observability/logger';

/** Batas official: order_list 1–50 per panggilan. */
const BATCH_LIMIT = 50;

/**
 * Batas percobaan ulang untuk kegagalan sementara dari Shopee.
 *
 * Kegagalan ini datang dari sisi Shopee, bukan dari data pemesanan kita, jadi
 * mencoba lagi beberapa saat kemudian adalah tindakan yang benar - bukan
 * menutupi kesalahan.
 */
const MAX_ATTEMPTS = 3;

/** Jeda antar percobaan. Bertambah linier supaya tidak membanjiri Shopee. */
const RETRY_DELAY_MS = 1_500;

/**
 * Pesan yang menandakan kegagalan sementara, bukan keputusan final Shopee.
 *
 * `Number of response is less than expected` muncul ketika Shopee selesai
 * memproses sebagian batch lalu potongan jawabannya hilang. Permintaan yang
 * sama hampir selalu berhasil bila diulang.
 */
const TRANSIENT_BATCH_FAILURES = [
  'number of response is less than expected',
  'system error',
  'request timeout',
  'too many request',
] as const;

function isTransientBatchFailure(detail: string): boolean {
  const lower = detail.toLowerCase();
  return TRANSIENT_BATCH_FAILURES.some((needle) => lower.includes(needle));
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────────
// Signing (identik dengan aturan Shopee v2; dipisah agar unit-test mudah)
// ─────────────────────────────────────────────────────────────────────────────

export function signShopeeRequest(
  cfg: ShopeeConfig,
  apiPath: string,
  timestamp: number,
  accessToken?: string,
  shopId?: string,
): string {
  const base = accessToken
    ? `${cfg.partnerId}${apiPath}${timestamp}${accessToken}${shopId ?? ''}`
    : `${cfg.partnerId}${apiPath}${timestamp}`;
  return crypto.createHmac('sha256', cfg.partnerKey).update(base).digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────────
// POST JSON + batch result parsing
// ─────────────────────────────────────────────────────────────────────────────

interface RawShopeeResponse {
  error?: string;
  message?: string;
  request_id?: string;
  response?: unknown;
}

async function postJson(
  cfg: ShopeeConfig,
  apiPath: string,
  body: Record<string, unknown>,
  creds: ShopCredentials,
  attempt = 1,
): Promise<RawShopeeResponse> {
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signShopeeRequest(cfg, apiPath, timestamp, creds.accessToken, creds.shopId);
  const url = new URL(apiPath, cfg.apiHost);
  url.searchParams.set('partner_id', cfg.partnerId);
  url.searchParams.set('timestamp', String(timestamp));
  url.searchParams.set('sign', sign);
  url.searchParams.set('access_token', creds.accessToken);
  url.searchParams.set('shop_id', creds.shopId);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new ExternalIntegrationError(
      'shopee',
      `Tidak dapat terhubung ke Shopee API (${apiPath}): ${(err as Error).message}`,
    );
  }

  const rawText = await res.text();
  let json: RawShopeeResponse;
  try {
    json = JSON.parse(rawText) as RawShopeeResponse;
  } catch {
    logger.error('Shopee API label mengembalikan response non-JSON', {
      apiPath,
      httpStatus: res.status,
      body: rawText.slice(0, 400),
    });
    throw new ExternalIntegrationError(
      'shopee',
      `Shopee API label mengembalikan response tidak valid (HTTP ${res.status}) di ${apiPath}.`,
    );
  }
  if (json.error) {
    // `common.batch_api_all_failed` (dan beberapa error batch lain) SELALU
    // menyertakan `result_list` berisi alasan sebenarnya per order. Tanpa
    // membacanya, operator hanya melihat "All failed" tanpa tahu apa yang
    // harus diperbaiki - itu sebabnya pesan label selalu tidak berguna.
    //
    // Bukti produksi: create_shipping_document menjawab
    //   [common.batch_api_all_failed] All failed, please check result_list
    // sementara alasan sebenarnya (mis. kanal tidak mendukung tipe label itu)
    // ada di dalam result_list.
    const detail = describeBatchFailure(json);

    // Kegtigaan dari Shopee, bukan kesalahan data kita. "Number of response is
    // less than expected" muncul saat Shopee menyelesaikan sebagian batch lalu
    // potongannya hilang - retry beberapa saat kemudian hampir selalu berhasil.
    // Tanpa retry, operator harus menekan ulang sendiri padahal tidak ada yang
    // salah dari sisi pemesanan.
    if (isTransientBatchFailure(detail) && attempt < MAX_ATTEMPTS) {
      logger.warn('Shopee gagal sementara saat membuat label, mencoba lagi', {
        apiPath,
        attempt,
        detail: detail.slice(0, 160),
      });
      await sleep(RETRY_DELAY_MS * attempt);
      return postJson(cfg, apiPath, body, creds, attempt + 1);
    }
    const msg = `Shopee API error [${json.error}] pada ${apiPath}: ${detail}`;
    logger.error(msg, { apiPath, request_id: json.request_id, error: json.error });
    throw new ExternalIntegrationError('shopee', msg, {
      providerCode: json.error,
      requestId: json.request_id,
      apiPath,
    });
  }
  return json;
}

/**
 * Ambil alasan sebenarnya dari `result_list` pada respons error batch Shopee.
 * Falls back ke pesan biasa kalau `result_list` tidak ada.
 */
function describeBatchFailure(json: RawShopeeResponse): string {
  const fallback = json.message ?? '(no message)';
  const response = json.response as Record<string, unknown> | undefined;
  const list =
    (Array.isArray(response?.result_list) && (response?.result_list as unknown[])) ||
    (Array.isArray(response?.result) && (response?.result as unknown[])) ||
    (Array.isArray((json as Record<string, unknown>).result_list) &&
      ((json as Record<string, unknown>).result_list as unknown[])) ||
    [];

  const reasons = list
    .map((row) => {
      if (typeof row !== 'object' || row === null) return null;
      const r = row as Record<string, unknown>;
      const failMessage = typeof r.fail_message === 'string' ? r.fail_message : '';
      const failError = typeof r.fail_error === 'string' ? r.fail_error : '';
      if (!failMessage && !failError) return null;
      const sn = typeof r.order_sn === 'string' ? r.order_sn : null;
      return sn ? `${sn}: ${failMessage || failError}` : failMessage || failError;
    })
    .filter((v): v is string => Boolean(v));

  if (reasons.length === 0) return fallback;
  return `${fallback} - ${reasons.join('; ')}`;
}

/** Bangun `order_list` sesuai dokumen: package_number & tracking_number tidak boleh string kosong. */
export function toOrderList(targets: LabelTarget[], includeTracking: boolean): Record<string, unknown>[] {
  return targets.map((t) => {
    const item: Record<string, unknown> = { order_sn: t.orderSn };
    if (t.packageNumber) item.package_number = t.packageNumber;
    if (includeTracking && t.trackingNumber) item.tracking_number = t.trackingNumber;
    return item;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Langkah 1: parameter / format label
// ─────────────────────────────────────────────────────────────────────────────

export async function getDocumentParameters(
  cfg: ShopeeConfig,
  creds: ShopCredentials,
  targets: LabelTarget[],
): Promise<DocumentParameter[]> {
  if (targets.length === 0 || targets.length > BATCH_LIMIT) {
    throw new ExternalIntegrationError(
      'shopee',
      `Jumlah paket untuk label harus 1–${BATCH_LIMIT}, diterima ${targets.length}.`,
    );
  }
  const json = await postJson(cfg, '/api/v2/logistics/get_shipping_document_parameter', {
    order_list: toOrderList(targets, false),
  }, creds);
  const entries = resultList(json.response);
  // Fail-closed: setiap target harus punya entri sendiri. Mengambil `entries[0]`
  // bisa memberi format label pesanan lain.
  return targets.map((target) => {
    const entry = entries.find(
      (item) => item.order_sn === target.orderSn && (item.package_number ?? null) === (target.packageNumber ?? null),
    );
    if (!entry) {
      throw new ExternalIntegrationError(
        'shopee',
        `Shopee tidak mengembalikan informasi label untuk pesanan ${target.orderSn}` +
          `${target.packageNumber ? ` paket ${target.packageNumber}` : ''}.`,
        { apiPath: '/api/v2/logistics/get_shipping_document_parameter', target },
      );
    }
    return mapDocumentParameter(entry);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Langkah 2: buat task pembuatan label
// ─────────────────────────────────────────────────────────────────────────────

export async function createDocument(
  cfg: ShopeeConfig,
  creds: ShopCredentials,
  target: LabelTarget,
  documentType: ShippingDocumentType,
): Promise<void> {
  const json = await postJson(cfg, '/api/v2/logistics/create_shipping_document', {
    order_list: [
      {
        ...toOrderList([target], true)[0],
        shipping_document_type: documentType,
      },
    ],
  }, creds);
  const entries = resultList(json.response);
  const matching = entries.find(
    (entry) => entry.order_sn === target.orderSn && (entry.package_number ?? null) === (target.packageNumber ?? null),
  );
  if (!matching) {
    throw new ExternalIntegrationError(
      'shopee',
      `Shopee tidak mengembalikan hasil pembuatan label untuk pesanan ${target.orderSn}` +
        `${target.packageNumber ? ` paket ${target.packageNumber}` : ''}.`,
      { apiPath: '/api/v2/logistics/create_shipping_document', target },
    );
  }
  const failError = typeof matching.fail_error === 'string' ? matching.fail_error : '';
  const failMessage = typeof matching.fail_message === 'string' ? matching.fail_message : '';
  if (failError || failMessage) {
    throw new ExternalIntegrationError(
      'shopee',
      `Shopee gagal membuat label untuk pesanan ${target.orderSn}: ${failMessage || failError}.`,
      { providerCode: failError || undefined, target },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Langkah 3: status task (READY = boleh diunduh)
// ─────────────────────────────────────────────────────────────────────────────

export async function getDocumentResult(
  cfg: ShopeeConfig,
  creds: ShopCredentials,
  target: LabelTarget,
  documentType: ShippingDocumentType,
): Promise<DocumentTask> {
  const item: Record<string, unknown> = {
    ...toOrderList([target], false)[0],
    shipping_document_type: documentType,
  };
  const json = await postJson(cfg, '/api/v2/logistics/get_shipping_document_result', {
    order_list: [item],
  }, creds);
  const entries = resultList(json.response) ?? [];
  const matching = entries.find(
    (entry) => entry.order_sn === target.orderSn && (entry.package_number ?? null) === (target.packageNumber ?? null),
  );
  if (!matching) {
    throw new ExternalIntegrationError(
      'shopee',
      `Shopee tidak mengembalikan status label untuk pesanan ${target.orderSn}` +
        `${target.packageNumber ? ` paket ${target.packageNumber}` : ''}.`,
      { apiPath: '/api/v2/logistics/get_shipping_document_result', target },
    );
  }
  const mapped = mapDocumentTask(matching);
  const hasFailure = Boolean(mapped.failError || mapped.failMessage);
  if (hasFailure || mapped.status === 'FAILED' || mapped.status === 'UNKNOWN') {
    throw new ExternalIntegrationError(
      'shopee',
      `Shopee belum bisa menyiapkan label untuk pesanan ${target.orderSn}: ` +
        `${mapped.failMessage ?? mapped.failError ?? `status ${mapped.status}`}.`,
      { providerCode: mapped.failError, apiPath: '/api/v2/logistics/get_shipping_document_result', target },
    );
  }
  return mapped;
}

// ─────────────────────────────────────────────────────────────────────────────
// Langkah 4: unduh file label (mengembalikan FILE, bukan JSON)
// ─────────────────────────────────────────────────────────────────────────────

export async function downloadDocument(
  cfg: ShopeeConfig,
  creds: ShopCredentials,
  target: LabelTarget,
  documentType: ShippingDocumentType,
): Promise<DownloadedLabel> {
  const timestamp = Math.floor(Date.now() / 1000);
  const apiPath = '/api/v2/logistics/download_shipping_document';
  const sign = signShopeeRequest(cfg, apiPath, timestamp, creds.accessToken, creds.shopId);
  const url = new URL(apiPath, cfg.apiHost);
  url.searchParams.set('partner_id', cfg.partnerId);
  url.searchParams.set('timestamp', String(timestamp));
  url.searchParams.set('sign', sign);
  url.searchParams.set('access_token', creds.accessToken);
  url.searchParams.set('shop_id', creds.shopId);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shipping_document_type: documentType,
        order_list: [toOrderList([target], false)[0]],
      }),
    });
  } catch (err) {
    throw new ExternalIntegrationError(
      'shopee',
      `Tidak dapat terhubung ke Shopee API (${apiPath}): ${(err as Error).message}`,
    );
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (!res.ok) {
    // Kegagalan biasanya dibalas JSON dengan `error` + `message`.
    const text = await res.text().catch(() => '');
    let detail = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(text) as RawShopeeResponse;
      if (j.error) detail = `[${j.error}] ${j.message ?? ''}`.trim();
    } catch {
      if (text) detail = text.slice(0, 200);
    }
    throw new ExternalIntegrationError(
      'shopee',
      `Shopee gagal mengunduh label untuk pesanan ${target.orderSn}: ${detail}.`,
      { apiPath, httpStatus: res.status, target },
    );
  }

  // Download resmi harus mengembalikan file. Jangan pernah membaca JSON error
  // atau HTML proxy sebagai `waybill` hanya karena HTTP status-nya 200.
  const raw = await res.arrayBuffer();
  const bytes = new Uint8Array(raw);
  if (bytes.length === 0) {
    throw new ExternalIntegrationError(
      'shopee',
      `Shopee mengirim file label kosong untuk pesanan ${target.orderSn}.`,
    );
  }
  const normalizedType = contentType.toLowerCase();
  const isJson = normalizedType.includes('json');
  const isText = normalizedType.startsWith('text/');
  if (isJson || isText) {
    let detail = contentType;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as RawShopeeResponse;
      if (parsed.error) detail = `[${parsed.error}] ${parsed.message ?? ''}`.trim();
    } catch {
      detail = new TextDecoder().decode(bytes).slice(0, 200);
    }
    throw new ExternalIntegrationError(
      'shopee',
      `Shopee tidak mengirim file label yang valid untuk pesanan ${target.orderSn}: ${detail}.`,
      { apiPath, contentType, target },
    );
  }
  // Deteksi tipe dari isi, bukan dari header — Shopee kadang mengirim
  // application/octet-stream untuk PDF.
  const looksPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF
  const looksZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (!isJson && !isText && !looksPdf && !looksZip) {
    const preview = new TextDecoder().decode(bytes.slice(0, 80)).replace(/\s+/g, ' ').trim();
    throw new ExternalIntegrationError(
      'shopee',
      `Shopee mengirim label dengan format yang tidak dikenali untuk pesanan ${target.orderSn}` +
        `${preview ? `: ${preview}` : '.'}`,
      { apiPath, contentType, target },
    );
  }
  const resolvedType = looksPdf ? 'application/pdf' : looksZip ? 'application/zip' : contentType || 'application/octet-stream';
  const ext = looksPdf ? 'pdf' : looksZip ? 'zip' : 'bin';
  return {
    orderSn: target.orderSn,
    packageNumber: target.packageNumber ?? null,
    fileName: `label-${target.orderSn}${target.packageNumber ? `-${target.packageNumber}` : ''}.${ext}`,
    bytes,
    contentType: resolvedType,
  };
}
