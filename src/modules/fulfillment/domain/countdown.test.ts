import { describe, expect, it } from 'vitest';
import { hitungSisaWaktu } from './countdown';

const now = new Date('2026-10-20T03:00:00.000Z');
const jam = (n: number) => new Date(now.getTime() + n * 3_600_000).toISOString();

describe('hitung sisa waktu batal', () => {
  it('tanpa batas kirim tidak menghasilkan hitungan', () => {
    expect(hitungSisaWaktu(null, now)).toBeNull();
    expect(hitungSisaWaktu(undefined, now)).toBeNull();
    expect(hitungSisaWaktu('bukan-tanggal', now)).toBeNull();
  });

  it('kurang dari sejam memakai satuan menit', () => {
    const hasil = hitungSisaWaktu(new Date(now.getTime() + 45 * 60_000).toISOString(), now);
    expect(hasil?.teks).toBe('Sisa 45 menit');
    expect(hasil?.nada).toBe('kritis');
  });

  it('kurang dari 24 jam → kritis, satuan jam', () => {
    const hasil = hitungSisaWaktu(jam(6), now);
    expect(hasil).toEqual({ teks: 'Sisa 6 jam', nada: 'kritis', jam: 6 });
  });

  it('24–72 jam → waspada dengan hari + jam', () => {
    expect(hitungSisaWaktu(jam(30), now)).toEqual({
      teks: 'Sisa 1 hari 6 jam',
      nada: 'waspada',
      jam: 30,
    });
  });

  it('lebih dari 72 jam → aman', () => {
    const hasil = hitungSisaWaktu(jam(96), now);
    expect(hasil?.nada).toBe('aman');
    expect(hasil?.teks).toBe('Sisa 4 hari');
  });

  it('batas yang sudah lewat ditandai "Lewat" dan bernada lewat', () => {
    const hasil = hitungSisaWaktu(jam(-3), now);
    expect(hasil).toEqual({ teks: 'Lewat 3 jam', nada: 'lewat', jam: -3 });
  });

  it('menerima objek Date maupun string ISO', () => {
    const target = new Date(now.getTime() + 10 * 3_600_000);
    expect(hitungSisaWaktu(target, now)?.teks).toBe('Sisa 10 jam');
    expect(hitungSisaWaktu(target.toISOString(), now)?.teks).toBe('Sisa 10 jam');
  });
});
