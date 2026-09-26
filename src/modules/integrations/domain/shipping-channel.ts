/**
 * Alur "Atur Pengiriman" (minta nomor resi) — sesuai dokumentasi resmi Shopee v2.
 *
 * MASALAH YANG DISELESAIKAN
 * ------------------------
 * Versi lama langsung mengirim `ship_order` dengan `dropoff: {}` tanpa pernah
 * bertanya ke Shopee channel mana yang benar-benar didukung. Akibatnya Shopee
 * menjawab `logistics.ship_order_unsupport_dropoff` dan operator terjebak:
 * "resi belum berhasil dibuat" tanpa ada cara memperbaiki.
 *
 * Alur resmi yang WAJIB diikuti (open.shopee.com/documents/v2):
 *   1. `get_shipping_parameter` → daftar channel yang DIDUKUNG pesanan ini
 *      (serta `pickup_time_id` / `branch_id` yang valid)
 *   2. `ship_order` dengan channel yang benar-benar didukung
 *   3. `get_tracking_number` → nomor resi (bisa "being allocated", lalu ulangi)
 *
 * Modul ini tidak pernah menebak channel. Kalau Shopee tidak mendukung channel
 * apa pun, operator diberi pesan yang menjelaskan harus menghubungi Shopee —
 * bukan pesan teknis yang tidak bisa ditindaklanjuti.
 */

import { ExternalIntegrationError } from '@/shared/errors/AppError';

/** Channel yang pernah didukung Shopee. `null` = Shopee tidak punya channel ini. */
export interface ShippingChannel {
  /** Kanal yang harus dikirim ke `ship_order`. */
  kind: 'pickup' | 'dropoff';
  /** `pickup_time_id` bila kanalnya pickup. */
  pickupTimeId?: string;
  /** `branch_id` bila kanalnya dropoff. */
  branchId?: string;
  /** Nama kanal untuk ditampilkan ke operator (dari Shopee bila ada). */
  label?: string;
}

/** Shopee bisa mengirim id sebagai angka; selalu dinormalkan ke string. */
function asString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function toArray(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null);
  }
  return [];
}

/**
 * Baca daftar kanal yang didukung dari respons `get_shipping_parameter`.
 * Tanpa argumen → array kosong (tidak ada kanal).
 */
export function extractSupportedChannels(res: unknown): ShippingChannel[] {
  // Bentuk respons yang benar-benar ditemukan: `response` dibungkus objek,
  // atau `response` itu sendiri berupa array, atau objek datar di level atas.
  const root: Record<string, unknown> | null =
    typeof res === 'object' && res !== null && !Array.isArray(res)
      ? (res as Record<string, unknown>)
      : null;
  const inner = root && typeof root.response === 'object' && root.response !== null
    ? (root.response as Record<string, unknown>)
    : null;

  // Sumber daftar channel: coba level terluar dulu, lalu isi `response`.
  const candidates: Array<Array<Record<string, unknown>>> = [];
  if (Array.isArray(res)) candidates.push(toArray(res));
  for (const scope of [root, inner]) {
    if (!scope) continue;
    for (const key of [
      'shipping_document_list',
      'supported_logistics_channels',
      'logistics_channel_list',
      'channel_list',
    ]) {
      const value = scope[key];
      if (Array.isArray(value)) {
        const rows = toArray(value);
        if (rows.length > 0) candidates.push(rows);
      }
    }
  }
  // Terakhir: objek datar yang langsung memuat daftar turunan (branch/pickup).
  if (root) candidates.push(toArray(root));

  const source = candidates.find((rows) => rows.length > 0) ?? [];
  // Objet datar (tanpa pembungkus list) diperlakukan sebagai satu entri supaya
  // `dropoff_branch_list` di level teratas tetap terbaca.
  const entries = source.length > 0 ? source : root ? [root] : [];

  const channels: ShippingChannel[] = [];

  // 1) Kanal pickup: butuh `pickup_time_id` dari daftar waktu jemput.
  for (const entry of entries) {
    const times = toArray(entry.pickup_time_list ?? entry.pickup_time_id_list);
    for (const t of times) {
      const timeId = asString(t?.pickup_time_id);
      if (!timeId) continue;
      channels.push({
        kind: 'pickup',
        pickupTimeId: timeId,
        label: asString(t?.pickup_time_name ?? t?.name) ?? undefined,
      });
    }
  }

  // 2) Kanal dropoff: butuh `branch_id` (cabang/agen kurir).
  for (const entry of entries) {
    for (const key of ['dropoff_branch_list', 'branch_list', 'dropoff_office_list']) {
      for (const b of toArray(entry[key])) {
        const branchId = asString(b?.branch_id ?? b?.office_id ?? b?.id);
        if (!branchId) continue;
        channels.push({
          kind: 'dropoff',
          branchId,
          label: asString(b?.branch_name ?? b?.office_name ?? b?.name) ?? undefined,
        });
      }
    }
    // Beberapa versi hanya menuliskan `dropoff_office` tunggal.
    const single = asString(entry.dropoff_office_id ?? entry.branch_id);
    if (single) {
      channels.push({ kind: 'dropoff', branchId: single });
    }
  }

  // Buang duplikat supaya pilihan operator tidak ganda.
  const seen = new Set<string>();
  return channels.filter((c) => {
    const key = `${c.kind}:${c.pickupTimeId ?? c.branchId ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Pilih kanal yang paling masuk akal untuk dikirim otomatis.
 *
 * Urutan pilihan:
 * 1. Kalau operator sudah memilih kanal (pickupTimeId/branchId) dan Shopee
 *    mendukungnya, pakai itu.
 * 2. Kalau tidak ada pilihan, ambil kanal pertama yang didukung Shopee.
 * 3. Kalau Shopee tidak mendukung channel apa pun → null (caller memberi pesan).
 */
export function pickChannel(
  channels: readonly ShippingChannel[],
  preferred?: { pickupTimeId?: string | null; branchId?: string | null },
): ShippingChannel | null {
  if (channels.length === 0) return null;

  if (preferred?.pickupTimeId) {
    const match = channels.find(
      (c) => c.kind === 'pickup' && c.pickupTimeId === preferred.pickupTimeId,
    );
    if (match) return match;
  }
  if (preferred?.branchId) {
    const match = channels.find((c) => c.kind === 'dropoff' && c.branchId === preferred.branchId);
    if (match) return match;
  }
  return channels[0]!;
}

/** Pesan error yang bisa ditindaklanjuti operator. */
export function describeNoChannel(orderSn: string): ExternalIntegrationError {
  return new ExternalIntegrationError(
    'shopee',
    `Pesanan ${orderSn} belum punya kanal pengiriman yang didukung Shopee, jadi nomor resi belum bisa diminta. ` +
      'Biasanya ini karena pengaturan logistic/channel di Shopee belum lengkap, atau pesanan sudah dikirim. ' +
      'Periksa pesanan ini di Seller Centre; bila tetap gagal, hubungi CS Shopee.',
    { target: { orderSn } },
  );
}
