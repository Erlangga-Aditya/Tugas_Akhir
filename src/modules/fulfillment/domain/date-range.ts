/**
 * Rentang tanggal untuk halaman Pesanan.
 *
 * Semua batas dihitung pada zona waktu **WIB (UTC+7)**, bukan UTC. Tanpa ini,
 * pesanan yang masuk pukul 06.30 WIB akan dianggap milik "kemarin" karena
 * tanggal UTC-nya masih hari sebelumnya — operator melihat angka yang tidak
 * cocok dengan Seller Centre Shopee.
 *
 * Rentang selalu setengah-terbuka `[from, to)` supaya sebuah pesanan tidak
 * pernah terhitung di dua hari sekaligus.
 */

export type RangePreset = 'today' | 'yesterday' | 'last7' | 'last30' | 'all';

export const RANGE_PRESETS: readonly RangePreset[] = ['today', 'yesterday', 'last7', 'last30', 'all'] as const;

export interface DateRange {
  from: Date | null;
  to: Date | null;
}

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const RANGE_LABEL: Record<RangePreset, string> = {
  today: 'Hari ini',
  yesterday: 'Kemarin',
  last7: '7 hari terakhir',
  last30: '30 hari terakhir',
  all: 'Semua tanggal',
};

export function isRangePreset(value: string | null | undefined): value is RangePreset {
  return typeof value === 'string' && (RANGE_PRESETS as readonly string[]).includes(value);
}

/** Awal hari WIB (00:00) yang memuat `instant`, dikembalikan sebagai instant UTC. */
export function startOfWibDay(instant: Date): Date {
  const shifted = new Date(instant.getTime() + WIB_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - WIB_OFFSET_MS);
}

/**
 * Ubah preset menjadi rentang nyata.
 * `now` wajib dikirim dari pemanggil supaya fungsi ini deterministik & bisa diuji.
 */
export function resolveRangePreset(preset: RangePreset, now: Date): DateRange {
  const todayStart = startOfWibDay(now);

  switch (preset) {
    case 'today':
      return { from: todayStart, to: new Date(todayStart.getTime() + DAY_MS) };
    case 'yesterday':
      return {
        from: new Date(todayStart.getTime() - DAY_MS),
        to: todayStart,
      };
    case 'last7':
      return { from: new Date(todayStart.getTime() - 6 * DAY_MS), to: new Date(todayStart.getTime() + DAY_MS) };
    case 'last30':
      return { from: new Date(todayStart.getTime() - 29 * DAY_MS), to: new Date(todayStart.getTime() + DAY_MS) };
    case 'all':
    default:
      return { from: null, to: null };
  }
}

/** Apakah `instant` berada di dalam rentang (batas atas eksklusif). */
export function isWithinRange(instant: Date, range: DateRange): boolean {
  if (range.from && instant.getTime() < range.from.getTime()) return false;
  if (range.to && instant.getTime() >= range.to.getTime()) return false;
  return true;
}

/** Syarat Prisma untuk kolom tanggal pesanan (`placedAt`). */
export function placedAtFilter(range: DateRange): { gte?: Date; lt?: Date } | undefined {
  if (!range.from && !range.to) return undefined;
  return {
    ...(range.from ? { gte: range.from } : {}),
    ...(range.to ? { lt: range.to } : {}),
  };
}
