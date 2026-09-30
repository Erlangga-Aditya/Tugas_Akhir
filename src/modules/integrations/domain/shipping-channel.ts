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
  /**
   * Kanal yang harus dikirim ke `ship_order`.
   *
   * ADA TIGA, bukan dua. Dokumentasi resmi (`ship_order`, API Reference)
   * menyatakan: field yang wajib disertakan adalah yang muncul di
   * `info_needed` dari `get_shipping_parameter` — `pickup`, `dropoff`, ATAU
   * `non_integrated`. Jenis ketiga ini dipakai kurir non-integrasi (mis.
   * kanal bawaan Shopee) dan tidak menerima `dropoff`.
   *
   * Sebelumnya jenis ini tidak ada, sehingga setiap kanal non-pickup dikirim
   * sebagai `dropoff` dan Shopee menolak dengan
   * `logistics.ship_order_unsupport_dropoff` — resi tidak pernah terbit
   * walaupun pesanannya sebenarnya bisa dikirim.
   */
  kind: 'pickup' | 'dropoff' | 'non_integrated';
  /**
   * `address_id` bila kanalnya pickup (wajib shopee: `info_needed.pickup`).
   *
   * DISIMPAN SEBAGAI STRING di sini, lalu dikirim sebagai NUMBER oleh adapter.
   * Shopee membalas `field pickup.address_id type error` kalau dikirim sebagai
   * string, dan `field pickup.pickup_time_id type error` kalau dikirim sebagai
   * angka — keduanya bertipe berbeda. Bukti sandbox 2026-09-27.
   */
  addressId?: string;
  /**
   * `pickup_time_id` bila kanalnya pickup.
   *
   * Nilainya bentuk TEKS seperti `1790499600_68` (timestamp slot + nomor slot)
   * dan HARUS dikirim apa adanya. Mengubahnya menjadi angka menghapus bagian
   * `_68` dan Shopee menjawab `field pickup.pickup_time_id type error`.
   * Bandingkan `addressId` yang justru wajib number.
   */
  pickupTimeId?: string;
  /** `branch_id` bila kanalnya dropoff. */
  branchId?: string;
  /** Nama kanal untuk ditampilkan ke operator (dari Shopee bila ada). */
  label?: string;
  /** Slot jemput yang Shopee tandai `recommended` (kalau ada). */
  recommended?: boolean;
}

/** Shopee bisa mengirim id sebagai angka; selalu dinormalkan ke string. */
function asString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * Ambil `info_needed` dari respons `get_shipping_parameter`.
 *
 * Bentuk resminya objek berisi kunci kanal yang didukung, misalnya:
 *   {"pickup": ["address_id", "pickup_time_id"]}
 *   {"dropoff": []}
 *   {"non_integrated": []}
 *
 * Nilai kuncinya bisa berupa daftar field atau nilai lain; yang penting di
 * sini HANYA kunci mana yang hadir, karena itulah yang menentukan field mana
 * yang wajib dikirim ke `ship_order`.
 */
function readInfoNeeded(
  root: Record<string, unknown> | null,
  inner: Record<string, unknown> | null,
): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const scope of [inner, root]) {
    if (!scope) continue;
    const value = scope.info_needed;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (!out.has(k)) out.set(k, v);
      }
    }
  }
  return out;
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

  // BENTUK RESMI (respons mentah sandbox 2026-09-26): daftar alamat jemput
  // berada di `response.pickup.address_list[]` — satu level lebih dalam dari
  // semua kunci yang pernah dikodekan. Tanpa cabang ini, Shopee yang jelas
  // menawar kanal dianggap tidak punya kanal sama sekali.
  for (const scope of [root, inner]) {
    if (!scope) continue;
    for (const key of ['pickup', 'dropoff', 'shipping', 'delivery']) {
      const sub = scope[key];
      if (sub && typeof sub === 'object' && !Array.isArray(sub)) {
        const bucket = sub as Record<string, unknown>;
        for (const listKey of ['address_list', 'branch_list', 'dropoff_branch_list', 'office_list']) {
          if (Array.isArray(bucket[listKey])) {
            candidates.push(toArray(bucket[listKey]));
          }
        }
        // `dropoff.branch_list` bisa `null` — itu normal, bukan error.
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

  // 1) Kanal pickup: butuh `address_id` + `pickup_time_id`.
  //
  // BENTUK RESMI (respons mentah sandbox 2026-09-26, order 260927416Q1VJ9):
  //   response.pickup.address_list[].time_slot_list[].pickup_time_id
  // Field `time_slot_list` inilah yang sebelumnya tidak dibaca — kode hanya
  // mencari `pickup_time_list`/`pickup_time_id_list`, jadi kanal Shopee yang
  // sebenarnya tersedia dianggap "tidak ada kanal yang didukung".
  for (const entry of entries) {
    for (const key of ['address_list', 'pickup_address_list', 'address_list_pickup']) {
      for (const addr of toArray(entry[key])) {
        const addressId = asString(addr.address_id);
        const slots = toArray(addr.time_slot_list ?? addr.pickup_time_list ?? addr.pickup_time_id_list);
        for (const t of slots) {
          const timeId = asString(t?.pickup_time_id);
          if (!timeId) continue;
          channels.push({
            kind: 'pickup',
            addressId: addressId ?? undefined,
            pickupTimeId: timeId,
            label: asString(t?.pickup_time_name ?? t?.name) ?? undefined,
            recommended: Array.isArray(t?.flags) && (t.flags as unknown[]).includes('recommended'),
          });
        }
      }
    }
    // Bentuk datar (entry = address + daftar slot sekaligus).
    const flatAddressId = asString(entry.address_id);
    const flatSlots = toArray(entry.time_slot_list ?? entry.pickup_time_list ?? entry.pickup_time_id_list);
    for (const t of flatSlots) {
      const timeId = asString(t?.pickup_time_id);
      if (!timeId) continue;
      channels.push({
        kind: 'pickup',
        addressId: flatAddressId ?? undefined,
        pickupTimeId: timeId,
        label: asString(t?.pickup_time_name ?? t?.name) ?? undefined,
        recommended: Array.isArray(t?.flags) && (t.flags as unknown[]).includes('recommended'),
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

  // 3) Kanal non-integrasi.
  //
  // `info_needed` adalah penentu resminya: kalau Shopee menuliskan
  // `non_integrated` di sana, `ship_order` WAJIB memakai field itu dan TIDAK
  // boleh memakai `dropoff`. Tanpa cabang ini, pesanan seperti itu selalu
  // ditolak Shopee walaupun kanalnya jelas tersedia.
  const infoNeeded = readInfoNeeded(root, inner);
  if (infoNeeded.has('non_integrated')) {
    channels.push({
      kind: 'non_integrated',
      label: asString(infoNeeded.get('non_integrated')) ?? undefined,
      recommended: true,
    });
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
 * 2. Kalau tidak ada pilihan, ambil slot jemput yang Shopee tandai
 *    `recommended` (lihat `flags` pada respons resmi) — ini slot paling awal
 *    yang masih memenuhi `ship_by_date`, jadi paling aman dikirim otomatis.
 * 3. Fallback ke kanal pertama.
 * 4. Kalau Shopee tidak mendukung channel apa pun → null (caller beri pesan).
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

  const recommended = channels.find((c) => c.recommended === true);
  if (recommended) return recommended;

  // Tanpa `recommended`, ambil slot paling awal: `pickup_time_id` Shopee berisi
  // timestamp, jadi pengurutan string sama dengan pengurutan waktu.
  const pickupTimes = channels
    .filter((c) => c.kind === 'pickup' && c.pickupTimeId)
    .sort((a, b) => (a.pickupTimeId! < b.pickupTimeId! ? -1 : 1));
  if (pickupTimes.length > 0) return pickupTimes[0]!;

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
