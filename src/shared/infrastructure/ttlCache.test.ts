import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTtlCache } from './ttlCache';

describe('cache TTL', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mengembalikan nilai selama belum kedaluwarsa', () => {
    const cache = createTtlCache<number>({ ttlMs: 1000 });
    cache.set('a', 1);
    vi.advanceTimersByTime(999);
    expect(cache.get('a')).toBe(1);
  });

  it('berhenti mengembalikan nilai setelah TTL lewat', () => {
    const cache = createTtlCache<number>({ ttlMs: 1000 });
    cache.set('a', 1);
    vi.advanceTimersByTime(1001);
    expect(cache.get('a')).toBeUndefined();
  });

  it('invalidatePrefix hanya membuang kunci yang cocok', () => {
    const cache = createTtlCache<number>({ ttlMs: 10_000 });
    cache.set('tenant-a|x', 1);
    cache.set('tenant-a|y', 2);
    cache.set('tenant-b|z', 3);
    cache.invalidatePrefix('tenant-a|');
    expect(cache.get('tenant-a|x')).toBeUndefined();
    expect(cache.get('tenant-a|y')).toBeUndefined();
    expect(cache.get('tenant-b|z')).toBe(3);
  });

  it('membatasi jumlah entri agar memori tidak tumbuh tanpa batas', () => {
    const cache = createTtlCache<number>({ ttlMs: 10_000, maxEntries: 3 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.set('d', 4);
    expect(cache.size).toBe(3);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('d')).toBe(4);
  });

  it('entri kedaluwarsa dibuang lebih dulu saat cache penuh', () => {
    const cache = createTtlCache<number>({ ttlMs: 100, maxEntries: 2 });
    cache.set('a', 1);
    vi.advanceTimersByTime(101);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });
});
