import { describe, expect, it } from 'vitest';
import {
  isWithinRange,
  placedAtFilter,
  resolveRangePreset,
  startOfWibDay,
} from './date-range';

const DAY = 24 * 60 * 60 * 1000;

describe('rentang tanggal (zona WIB)', () => {
  // 18 Okt 2026 09:00 WIB = 02:00 UTC
  const now = new Date('2026-10-18T02:00:00.000Z');

  it('awal hari WIB adalah 00:00 WIB, bukan 00:00 UTC', () => {
    expect(startOfWibDay(now).toISOString()).toBe('2026-10-17T17:00:00.000Z');
  });

  it('hari ini mencakup [00:00 WIB, 24:00 WIB)', () => {
    const range = resolveRangePreset('today', now);
    expect(range.from?.toISOString()).toBe('2026-10-17T17:00:00.000Z');
    expect(range.to?.toISOString()).toBe('2026-10-18T17:00:00.000Z');
  });

  it('kemarin berakhir tepat di awal hari ini (tidak tumpang tindih)', () => {
    const kemarin = resolveRangePreset('yesterday', now);
    const hariIni = resolveRangePreset('today', now);
    expect(kemarin.to?.getTime()).toBe(hariIni.from?.getTime());
    expect(kemarin.from?.getTime()).toBe((hariIni.from?.getTime() ?? 0) - DAY);
  });

  it('7 hari terakhir mencakup hari ini + 6 hari sebelumnya', () => {
    const range = resolveRangePreset('last7', now);
    const hariIni = resolveRangePreset('today', now);
    expect(range.to?.getTime()).toBe(hariIni.to?.getTime());
    expect((range.to?.getTime() ?? 0) - (range.from?.getTime() ?? 0)).toBe(7 * DAY);
  });

  it('30 hari terakhir mencakup 30 hari penuh', () => {
    const range = resolveRangePreset('last30', now);
    expect((range.to?.getTime() ?? 0) - (range.from?.getTime() ?? 0)).toBe(30 * DAY);
  });

  it('semua tanggal tidak memberi batas', () => {
    expect(resolveRangePreset('all', now)).toEqual({ from: null, to: null });
    expect(placedAtFilter({ from: null, to: null })).toBeUndefined();
  });

  it('pesanan pukul 00:30 WIB masuk hari ini, bukan kemarin', () => {
    // 17 Okt 17:30 UTC = 18 Okt 00:30 WIB
    const pesanan = new Date('2026-10-17T17:30:00.000Z');
    expect(isWithinRange(pesanan, resolveRangePreset('today', now))).toBe(true);
    expect(isWithinRange(pesanan, resolveRangePreset('yesterday', now))).toBe(false);
  });

  it('batas atas bersifat eksklusif agar tidak terhitung dua hari', () => {
    const hariIni = resolveRangePreset('today', now);
    const tepatTengahMalam = new Date('2026-10-18T17:00:00.000Z');
    expect(isWithinRange(tepatTengahMalam, hariIni)).toBe(false);
  });

  it('placedAtFilter hanya mengisi batas yang ada', () => {
    expect(placedAtFilter({ from: now, to: null })).toEqual({ gte: now });
    expect(placedAtFilter({ from: null, to: now })).toEqual({ lt: now });
  });
});
