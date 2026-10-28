import { describe, it, expect } from 'vitest';
import {
  isNomorMingguGaji,
  parseNomorMingguGaji,
  jumlahHariDalamBulan,
  selesaikanMingguGaji,
  mingguGajiBerdasarkanTanggal,
  NOMOR_MINGGU_GAJI,
} from './minggu-gaji';

describe('minggu-gaji', () => {
  describe('parseNomorMingguGaji', () => {
    it('mengembalikan angka asli dari string query — bukan string mentahnya', () => {
      // REGRESI: kalau yang lewat masih string, di selesaikanMingguGaji
      // '2' + 1 menjadi '21' dan merusak seluruh perhitungan rentang.
      expect(parseNomorMingguGaji('2')).toBe(2);
      expect(typeof parseNomorMingguGaji('2')).toBe('number');
      expect(parseNomorMingguGaji('1')).toBe(1);
      expect(parseNomorMingguGaji('4')).toBe(4);
    });

    it('menerima angka langsung', () => {
      expect(parseNomorMingguGaji(3)).toBe(3);
    });

    it('menolak nilai di luar 1–4 dan bukan angka', () => {
      expect(parseNomorMingguGaji('0')).toBeNull();
      expect(parseNomorMingguGaji('5')).toBeNull();
      expect(parseNomorMingguGaji('abc')).toBeNull();
      expect(parseNomorMingguGaji(null)).toBeNull();
      expect(parseNomorMingguGaji(undefined)).toBeNull();
    });
  });

  describe('isNomorMingguGaji', () => {
    it('menerima "1" sampai "4"', () => {
      expect(isNomorMingguGaji('1')).toBe(true);
      expect(isNomorMingguGaji('2')).toBe(true);
      expect(isNomorMingguGaji('3')).toBe(true);
      expect(isNomorMingguGaji('4')).toBe(true);
    });

    it('menolak nilai di luar 1–4', () => {
      expect(isNomorMingguGaji('0')).toBe(false);
      expect(isNomorMingguGaji('5')).toBe(false);
      expect(isNomorMingguGaji('abc')).toBe(false);
      expect(isNomorMingguGaji(null)).toBe(false);
      expect(isNomorMingguGaji(undefined)).toBe(false);
    });
  });

  describe('jumlahHariDalamBulan', () => {
    it('mengembalikan jumlah hari yang benar per bulan', () => {
      expect(jumlahHariDalamBulan(2026, 1)).toBe(31);  // Januari
      expect(jumlahHariDalamBulan(2026, 2)).toBe(28);  // Februari 2026 (bukan kabisat)
      expect(jumlahHariDalamBulan(2024, 2)).toBe(29);  // Februari 2024 (kabisat)
      expect(jumlahHariDalamBulan(2026, 4)).toBe(30);  // April
      expect(jumlahHariDalamBulan(2026, 12)).toBe(31); // Desember
    });
  });

  describe('selesaikanMingguGaji', () => {
    it('minggu 1 = tanggal 1–7', () => {
      const r = selesaikanMingguGaji(2026, 10, 1);
      expect(r.tanggalAwal).toBe(1);
      expect(r.tanggalAkhir).toBe(7);
      expect(r.bulan).toBe(10);
      expect(r.tahun).toBe(2026);
      // from = 1 Oktober 2026 00:00 WIB = 30 September 2026 17:00 UTC
      expect(r.from.toISOString()).toBe('2026-09-30T17:00:00.000Z');
      // to = 8 Oktober 2026 00:00 WIB = 7 Oktober 2026 17:00 UTC
      expect(r.to.toISOString()).toBe('2026-10-07T17:00:00.000Z');
    });

    it('minggu 2 = tanggal 8–14', () => {
      const r = selesaikanMingguGaji(2026, 10, 2);
      expect(r.tanggalAwal).toBe(8);
      expect(r.tanggalAkhir).toBe(14);
      expect(r.from.toISOString()).toBe('2026-10-07T17:00:00.000Z');
      // to = 15 Oktober 2026 00:00 WIB = 14 Oktober 2026 17:00 UTC
      expect(r.to.toISOString()).toBe('2026-10-14T17:00:00.000Z');
    });

    it('minggu 3 = tanggal 15–21', () => {
      const r = selesaikanMingguGaji(2026, 10, 3);
      expect(r.tanggalAwal).toBe(15);
      expect(r.tanggalAkhir).toBe(21);
      expect(r.from.toISOString()).toBe('2026-10-14T17:00:00.000Z');
      // to = 22 Oktober 2026 00:00 WIB = 21 Oktober 2026 17:00 UTC
      expect(r.to.toISOString()).toBe('2026-10-21T17:00:00.000Z');
    });

    it('minggu 4 = tanggal 22 sampai akhir bulan', () => {
      const r = selesaikanMingguGaji(2026, 10, 4); // Oktober = 31 hari
      expect(r.tanggalAwal).toBe(22);
      expect(r.tanggalAkhir).toBe(31);
      expect(r.from.toISOString()).toBe('2026-10-21T17:00:00.000Z');
      // to = 1 November 2026 00:00 WIB (batas atas eksklusif)
      expect(r.to.toISOString()).toBe('2026-10-31T17:00:00.000Z');
    });

    it('minggu 4 februari pendek', () => {
      const r = selesaikanMingguGaji(2026, 2, 4); // Februari 2026 = 28 hari
      expect(r.tanggalAwal).toBe(22);
      expect(r.tanggalAkhir).toBe(28);
      // to = 1 Maret 2026 00:00 WIB
      expect(r.to.toISOString()).toBe('2026-02-28T17:00:00.000Z');
    });

    it('minggu 4 desember menutup tahun', () => {
      const r = selesaikanMingguGaji(2026, 12, 4);
      expect(r.tanggalAkhir).toBe(31);
      // to = 1 Januari 2027 00:00 WIB
      expect(r.to.toISOString()).toBe('2026-12-31T17:00:00.000Z');
    });

    it('rentang setengah-terbuka — from ada, to ada, to > from', () => {
      for (const minggu of NOMOR_MINGGU_GAJI) {
        const r = selesaikanMingguGaji(2026, 10, minggu);
        expect(r.from).toBeInstanceOf(Date);
        expect(r.to).toBeInstanceOf(Date);
        expect(r.to.getTime()).toBeGreaterThan(r.from.getTime());
      }
    });

    it('minggu berurutan saling bersambung tanpa celah', () => {
      const m1 = selesaikanMingguGaji(2026, 10, 1);
      const m2 = selesaikanMingguGaji(2026, 10, 2);
      const m3 = selesaikanMingguGaji(2026, 10, 3);
      const m4 = selesaikanMingguGaji(2026, 10, 4);
      expect(m1.to.getTime()).toBe(m2.from.getTime());
      expect(m2.to.getTime()).toBe(m3.from.getTime());
      expect(m3.to.getTime()).toBe(m4.from.getTime());
    });
  });

  describe('mingguGajiBerdasarkanTanggal', () => {
    it('tanggal 1 awal bulan → minggu 1', () => {
      // 1 Oktober 2026 10:00 WIB = 04:00 UTC
      const t = new Date('2026-10-01T03:00:00.000Z'); // jam 10:00 WIB
      const r = mingguGajiBerdasarkanTanggal(t);
      expect(r.minggu).toBe(1);
      expect(r.bulan).toBe(10);
      expect(r.tahun).toBe(2026);
    });

    it('tanggal 7 akhir minggu 1 → masih minggu 1', () => {
      const t = new Date('2026-10-07T20:00:00.000Z'); // 8 Okt 03:00 WIB — HATI-HATI
      // 7 Oktober 2026 pukul 20:00 UTC = 8 Oktober 03:00 WIB → minggu 2!
      const r = mingguGajiBerdasarkanTanggal(t);
      expect(r.minggu).toBe(2);
    });

    it('tanggal 8 → minggu 2', () => {
      const t = new Date('2026-10-08T03:00:00.000Z'); // 08:00 WIB
      expect(mingguGajiBerdasarkanTanggal(t).minggu).toBe(2);
    });

    it('tanggal 15 → minggu 3', () => {
      const t = new Date('2026-10-15T03:00:00.000Z');
      expect(mingguGajiBerdasarkanTanggal(t).minggu).toBe(3);
    });

    it('tanggal 22 → minggu 4', () => {
      const t = new Date('2026-10-22T03:00:00.000Z');
      expect(mingguGajiBerdasarkanTanggal(t).minggu).toBe(4);
    });

    it('tanggal 31 akhir bulan → masih minggu 4', () => {
      const t = new Date('2026-10-31T03:00:00.000Z');
      expect(mingguGajiBerdasarkanTanggal(t).minggu).toBe(4);
    });

    it('jam 00:30 WIB tetap di hari yang benar', () => {
      // 8 Oktober 2026 00:30 WIB = 7 Oktober 2026 17:30 UTC
      const t = new Date('2026-10-07T17:30:00.000Z');
      expect(mingguGajiBerdasarkanTanggal(t).minggu).toBe(2);
    });
  });
});
