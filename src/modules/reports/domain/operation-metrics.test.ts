import { describe, expect, it } from 'vitest';
import { hitungTahap, TAHAP_OPERASIONAL } from './operation-metrics';

describe('TAHAP_OPERASIONAL', () => {
  it('mengandung semua tahap yang diharapkan', () => {
    const expected = new Set([
      'perluProduksi',
      'siapDiambil',
      'sedangDipacking',
      'siapDiserahkan',
      'sudahDiserahkan',
      'diterimaShopee',
      'gagal',
    ]);
    for (const key of Object.keys(TAHAP_OPERASIONAL) as Array<keyof typeof TAHAP_OPERASIONAL>) {
      expect(expected.has(key)).toBe(true);
    }
  });
});

describe('hitungTahap', () => {
  const contoh = (statuses: string[]) => ({
    perluProduksi: statuses.filter((s) => s === 'WAITING_STOCK').length,
    siapDiambil: statuses.filter((s) => s === 'READY_TO_PICK').length,
    sedangDipacking: statuses.filter((s) => ['PICKING', 'PICKED', 'PACKING'].includes(s)).length,
    siapDiserahkan: statuses.filter((s) => ['PACKED', 'READY_TO_SHIP'].includes(s)).length,
    sudahDiserahkan: statuses.filter((s) => s === 'HANDED_OVER').length,
    diterimaShopee: 0,
    gagal: statuses.filter((s) => s === 'EXCEPTION').length,
  });

  it('menangani status kosong', () => {
    expect(hitungTahap([])).toEqual(contoh([]));
  });

  it('mengelompokkan status WAITING_STOCK → perluProduksi', () => {
    expect(hitungTahap(['WAITING_STOCK', 'WAITING_STOCK', 'WAITING_STOCK']).perluProduksi).toBe(3);
  });

  it('mengelompokkan PICKING/PICKED/PACKING → sedangDipacking', () => {
    const r = hitungTahap(['PICKING', 'PICKED', 'PACKING']);
    expect(r.sedangDipacking).toBe(3);
    expect(r.perluProduksi).toBe(0);
  });

  it('mengelompokkan PACKED/READY_TO_SHIP → siapDiserahkan', () => {
    const r = hitungTahap(['PACKED', 'READY_TO_SHIP']);
    expect(r.siapDiserahkan).toBe(2);
  });

  it('EXCEPTION → gagal', () => {
    expect(hitungTahap(['EXCEPTION', 'EXCEPTION']).gagal).toBe(2);
  });

  it('status tidak dikenal tidak masuk ke kelompok apa pun', () => {
    const r = hitungTahap(['FOOBAR']);
    for (const key of Object.keys(r) as Array<keyof typeof r>) {
      if (key === 'diterimaShopee') continue;
      expect(r[key]).toBe(0);
    }
  });
});
