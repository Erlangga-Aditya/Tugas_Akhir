import { describe, expect, it } from 'vitest';
import { hitungTahap, isTahapOperasional, TAHAP_OPERASIONAL, tahapDariStatus } from './operation-metrics';

describe('TAHAP_OPERASIONAL', () => {
  it('mengandung semua tahap yang diharapkan — tanpa kartu "gagal"', () => {
    expect(Object.keys(TAHAP_OPERASIONAL).sort()).toEqual(
      [
        'perluProduksi',
        'siapDiambil',
        'sedangDipacking',
        'siapDiserahkan',
        'sudahDiserahkan',
        'diterimaShopee',
      ].sort(),
    );
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

  it('EXCEPTION TIDAK masuk kelompok apa pun — itu penutup pesanan batal, bukan pekerjaan gudang', () => {
    const r = hitungTahap(['EXCEPTION', 'EXCEPTION']);
    for (const key of Object.keys(r) as Array<keyof typeof r>) {
      expect(r[key]).toBe(0);
    }
  });

  it('status tidak dikenal tidak masuk ke kelompok apa pun', () => {
    const r = hitungTahap(['FOOBAR']);
    for (const key of Object.keys(r) as Array<keyof typeof r>) {
      expect(r[key]).toBe(0);
    }
  });
});

describe('tahapDariStatus', () => {
  it('HANDED_OVER → sudahDiserahkan', () => {
    expect(tahapDariStatus('HANDED_OVER')).toBe('sudahDiserahkan');
  });

  it('EXCEPTION → null', () => {
    expect(tahapDariStatus('EXCEPTION')).toBeNull();
  });
});

describe('isTahapOperasional — guard parameter ?tahap= dari URL', () => {
  it('menerima semua kunci TAHAP_OPERASIONAL', () => {
    for (const key of Object.keys(TAHAP_OPERASIONAL)) {
      expect(isTahapOperasional(key)).toBe(true);
    }
  });

  it('menolak nilai tak dikenal, kosong, dan bukan string', () => {
    expect(isTahapOperasional('gagal')).toBe(false);
    expect(isTahapOperasional('PERLU_PRODUKSI')).toBe(false);
    expect(isTahapOperasional('')).toBe(false);
    expect(isTahapOperasional(null)).toBe(false);
    expect(isTahapOperasional(undefined)).toBe(false);
    expect(isTahapOperasional(42 as unknown as string)).toBe(false);
  });
});
