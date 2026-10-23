import { describe, expect, it } from 'vitest';
import { awalHari, buatKodeBatch, identitasCetakSama, kunciCetak } from './production-batch';

describe('kunci cetak & kode batch', () => {
  it('mengabaikan urutan dan duplikat orderId', () => {
    expect(kunciCetak(['b', 'a', 'b', 'c'])).toBe(kunciCetak(['a', 'c', 'b']));
    expect(kunciCetak([])).toBe('');
  });

  it('mendeteksi cetakan identik vs berbeda', () => {
    expect(identitasCetakSama(kunciCetak(['x', 'y']), kunciCetak(['y', 'x']))).toBe(true);
    expect(identitasCetakSama(kunciCetak(['x']), kunciCetak(['x', 'y']))).toBe(false);
    expect(identitasCetakSama(null, kunciCetak(['x']))).toBe(false);
  });

  it('kode batch: PROD-YYYYMMDD-urutan', () => {
    expect(buatKodeBatch(new Date(2026, 9, 22), 1)).toBe('PROD-20261022-1');
    expect(buatKodeBatch(new Date(2026, 0, 5), 12)).toBe('PROD-20260105-12');
  });

  it('awal hari lokal', () => {
    const d = awalHari(new Date(2026, 9, 22, 14, 30));
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });
});
