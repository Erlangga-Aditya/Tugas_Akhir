/**
 * Shipping label — alur RESMI Shopee Open Platform v2.
 *
 * Fakta yang dipakai di sini (verifikasi 2026-09 ke API dokumentasi resmi
 * `open.shopee.com/opservice/api/v1/doc/api/?version=2&api_name=...`):
 *
 * 1. Alur label WAJIB 4 langkah, tidak boleh dilewati:
 *      get_shipping_document_parameter  → type yang valid/saran
 *      create_shipping_document         → buat task (butuh tracking number)
 *      get_shipping_document_result     → status; hanya `READY` yang bisa diunduh
 *      download_shipping_document       → mengembalikan FILE waybill (bukan JSON)
 * 2. `create_shipping_document` hanya tersedia SETELAH resi (tracking number) ada.
 * 3. Enum `shipping_document_type` yang terdaftar resmi:
 *      NORMAL_AIR_WAYBILL, THERMAL_AIR_WAYBILL, NORMAL_JOB_AIR_WAYBILL,
 *      THERMAL_JOB_AIR_WAYBILL, THERMAL_UNPACKAGED_LABEL
 * 4. `get_shipping_document_parameter` mengembalikan
 *    `selectable_shipping_document_type[]` per pesanan — JANGAN menebak format;
 *    pakai yang disarankan kalau ada, kalau tidak pakai milik seller.
 * 5. DOKUMEN RESMI: `allow_self_design_awb` pada `get_order_detail` —
 *    "if allow_self_design_awb returns false, it means that the package does
 *     not allow for self-designed AWB and only the system-AWB can be used."
 *    Karena itu aplikasi ini TIDAK PERNAH membuat label sendiri. Label hanya
 *    ditampilkan dari file yang diunduh Shopee, apa adanya.
 * 6. Ukuran kertas, barcode, dan tata letak label sepenuhnya milik Shopee
 *    (file Thermal/thermal printer). Aplikasi tidak mengubah ukurannya, sehingga
 *    tidak mungkin berubah. Semua ukuran dan barcode "standar" berasal dari Shopee.
 *
 * Karena itu modul ini tidak pernah mengarang: kalau Shopee menolak, error-nya
 * diteruskan apa adanya ke pengguna.
 */

import { NotFoundError, ExternalIntegrationError } from '@/shared/errors/AppError';
import { ShopCredentials } from '../domain/marketplace.adapter';

/**
 * Kredensial koneksi Shopee (partner-level) yang dibutuhkan untuk menandatangani
 * request. Berasal dari konfigurasi aplikasi (UI/DB) dengan fallback .env.
 */
export interface ShopeeConfig {
  partnerId: string;
  partnerKey: string;
  /** Host API aktif: sandbox atau produksi. */
  apiHost: string;
}

export type ShippingDocumentType =
  | 'NORMAL_AIR_WAYBILL'
  | 'THERMAL_AIR_WAYBILL'
  | 'NORMAL_JOB_AIR_WAYBILL'
  | 'THERMAL_JOB_AIR_WAYBILL'
  | 'THERMAL_UNPACKAGED_LABEL';

/** Satu paket (bisa satu pesanan terbagi beberapa paket). */
export interface LabelTarget {
  orderSn: string;
  packageNumber?: string | null;
  /** Resi — wajib supaya Shopee bisa membuat dokumen. */
  trackingNumber?: string | null;
}

export interface DocumentParameter {
  orderSn: string;
  packageNumber: string | null;
  /** Format yang disarankan Shopee untuk paket ini. */
  suggestedType: ShippingDocumentType | null;
  /** Semua format yang boleh dipakai (dari Shopee, bukan asumsi kita). */
  selectableTypes: ShippingDocumentType[];
  failError?: string;
  failMessage?: string;
}

export type DocumentStatus = 'READY' | 'PROCESSING' | 'FAILED' | 'UNKNOWN';

export interface DocumentTask {
  orderSn: string;
  packageNumber: string | null;
  status: DocumentStatus;
  failError?: string;
  failMessage?: string;
}

export interface DownloadedLabel {
  orderSn: string;
  packageNumber: string | null;
  fileName: string;
  /** Isi file label asli dari Shopee (PDF/gambar/whatever Shopee kirim). */
  bytes: Uint8Array;
  contentType: string;
}

export interface ShippingDocumentPort {
  /** 1) Format label yang valid untuk paket-paket ini. */
  getDocumentParameters(credentials: ShopCredentials, targets: LabelTarget[]): Promise<DocumentParameter[]>;
  /** 2) Buat task pembuatan label. Butuh resi. */
  createDocument(
    credentials: ShopCredentials,
    target: LabelTarget,
    documentType: ShippingDocumentType,
  ): Promise<void>;
  /** 3) Status task; hanya READY yang boleh diunduh. */
  getDocumentResult(credentials: ShopCredentials, target: LabelTarget, documentType: ShippingDocumentType): Promise<DocumentTask>;
  /** 4) Unduh file label resmi. */
  downloadDocument(
    credentials: ShopCredentials,
    target: LabelTarget,
    documentType: ShippingDocumentType,
  ): Promise<DownloadedLabel>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pemetaan respons (toleran: Shopee kadang menambah/mengubah field)
// ─────────────────────────────────────────────────────────────────────────────

const VALID_TYPES: readonly ShippingDocumentType[] = [
  'NORMAL_AIR_WAYBILL',
  'THERMAL_AIR_WAYBILL',
  'NORMAL_JOB_AIR_WAYBILL',
  'THERMAL_JOB_AIR_WAYBILL',
  'THERMAL_UNPACKAGED_LABEL',
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function isValidDocumentType(value: unknown): value is ShippingDocumentType {
  return typeof value === 'string' && (VALID_TYPES as readonly string[]).includes(value);
}

/** Ekstrak `result_list` dari respons batch Shopee (berkas per paket). */
export function resultList(response: unknown): Record<string, unknown>[] {
  const root = asRecord(response);
  return asArray(root.result_list).map(asRecord);
}

/** `status` hanya READY/PROCESSING/FAILED yang berarti; lain → UNKNOWN. */
export function mapDocumentStatus(value: unknown): DocumentStatus {
  const s = str(value).toUpperCase();
  if (s === 'READY' || s === 'PROCESSING' || s === 'FAILED') return s;
  return 'UNKNOWN';
}

export function mapDocumentParameter(entry: Record<string, unknown>): DocumentParameter {
  const selectable = asArray(entry.selectable_shipping_document_type)
    .filter(isValidDocumentType)
    .filter((t, i, arr) => arr.indexOf(t) === i);
  const suggested = isValidDocumentType(entry.suggest_shipping_document_type)
    ? entry.suggest_shipping_document_type
    : null;
  return {
    orderSn: str(entry.order_sn),
    packageNumber: asString(entry.package_number),
    suggestedType: suggested,
    selectableTypes: selectable,
    failError: asString(entry.fail_error) ?? undefined,
    failMessage: asString(entry.fail_message) ?? undefined,
  };
}

export function mapDocumentTask(entry: Record<string, unknown>): DocumentTask {
  return {
    orderSn: str(entry.order_sn),
    packageNumber: asString(entry.package_number),
    status: mapDocumentStatus(entry.status),
    failError: asString(entry.fail_error) ?? undefined,
    failMessage: asString(entry.fail_message) ?? undefined,
  };
}

/** UrutanPolling: READY dulu, lalu jeda, ulangi sampai `maxAttempts`. */
export const DOCUMENT_POLL_DELAYS_MS = [0, 900, 1800, 3000, 5000] as const;

export async function pollUntilReady(
  fetchStatus: () => Promise<DocumentTask>,
  delaysMs: readonly number[] = DOCUMENT_POLL_DELAYS_MS,
): Promise<DocumentTask> {
  let last: DocumentTask | null = null;
  for (const delay of delaysMs) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    last = await fetchStatus();
    if (last.status === 'READY' || last.status === 'FAILED') return last;
  }
  return last ?? { orderSn: '', packageNumber: null, status: 'UNKNOWN' };
}

/** Pesan error yang bisa dibaca orang, tanpa menutupi error asli Shopee. */
export function describeLabelFailure(param: DocumentParameter, target: LabelTarget): string {
  if (param.failError) {
    return `Shopee tidak bisa membuat label untuk pesanan ${target.orderSn}: ${param.failMessage ?? param.failError}.`;
  }
  if (param.selectableTypes.length === 0 && !param.suggestedType) {
    return (
      `Belum ada format label yang tersedia untuk pesanan ${target.orderSn}. ` +
      'Biasanya ini karena resi belum terbit atau paket belum siap dilabeli di Shopee.'
    );
  }
  return `Label untuk pesanan ${target.orderSn} belum bisa dibuat.`;
}

export function assertHasTrackingNumber(target: LabelTarget): void {
  if (!target.trackingNumber) {
    throw new ExternalIntegrationError(
      'shopee',
      `Pesanan ${target.orderSn} belum punya nomor resi dari Shopee, jadi label resmi belum bisa dibuat. ` +
        'Selesaikan "Atur Pengiriman" dulu sampai nomor resi muncul.',
    );
  }
}

export function requireTarget(orderSn: string, id: string): LabelTarget {
  if (!orderSn) throw new NotFoundError('Nomor pesanan Shopee', id);
  return { orderSn, packageNumber: null, trackingNumber: null };
}
