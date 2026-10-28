import { describe, expect, it } from 'vitest';
import type { NextRequest } from 'next/server';
import { getEnumQueryParam } from './routeHelpers';

/** Request palsu: cukup punya `url`, seperti yang dibaca helper. */
const req = (url: string) => ({ url } as unknown as NextRequest);

const NILAI = ['PENDING', 'READY_TO_SHIP', 'DELIVERED'] as const;

describe('getEnumQueryParam', () => {
  it('mengembalikan nilai yang sah', () => {
    expect(getEnumQueryParam(req('http://x/api?status=PENDING'), 'status', NILAI)).toBe('PENDING');
  });

  it('memangkas spasi di tepi', () => {
    expect(getEnumQueryParam(req('http://x/api?status=%20DELIVERED%20'), 'status', NILAI)).toBe(
      'DELIVERED',
    );
  });

  it('nilai asing diabaikan, bukan diteruskan ke database', () => {
    // Inilah bug yang ditemukan di produksi: `?status=ALL` diteruskan apa adanya
    // ke Prisma (karena `as ShipmentStatus` hanya ada di TypeScript), query
    // gagal, dan endpoint membalas daftar kosong — terbaca seperti data hilang.
    expect(getEnumQueryParam(req('http://x/api?status=ALL'), 'status', NILAI)).toBeUndefined();
    expect(
      getEnumQueryParam(req('http://x/api?status=yang-tidak-ada'), 'status', NILAI),
    ).toBeUndefined();
  });

  it('peka huruf besar-kecil: nilai kecil tidak diam-diam diterima', () => {
    // Kalau diterima, arti parameter jadi tidak tunggal dan filter bisa meleset.
    expect(getEnumQueryParam(req('http://x/api?status=pending'), 'status', NILAI)).toBeUndefined();
  });

  it('parameter kosong / tidak ada dianggap tidak memfilter', () => {
    expect(getEnumQueryParam(req('http://x/api?status='), 'status', NILAI)).toBeUndefined();
    expect(getEnumQueryParam(req('http://x/api'), 'status', NILAI)).toBeUndefined();
    expect(getEnumQueryParam(req('http://x/api?status=%20%20'), 'status', NILAI)).toBeUndefined();
  });
});
