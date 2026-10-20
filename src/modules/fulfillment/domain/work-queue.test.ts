import { describe, expect, it } from 'vitest';
import { belongsToBucket, classifyWorkQueue, countBuckets, type WorkQueueInput } from './work-queue';

const q = (over: Partial<WorkQueueInput> = {}) =>
  classifyWorkQueue({
    orderStatus: 'CONFIRMED',
    externalStatus: 'READY_TO_SHIP',
    fulfillmentStatus: null,
    shipmentStatus: null,
    hasAwb: false,
    ...over,
  });

describe('antrean kerja gudang — mengikuti status Shopee', () => {
  it('READY_TO_SHIP = "Belum diproses" → kartu Pesanan Baru', () => {
    expect(q()).toMatchObject({ needsWork: true, bucket: 'baru' });
  });

  it('PROCESSED = "Telah diproses" → kartu Sudah Ada Resi', () => {
    expect(q({ externalStatus: 'PROCESSED', hasAwb: true, fulfillmentStatus: 'READY_TO_SHIP' })).toMatchObject({
      needsWork: true,
      bucket: 'sudahResi',
    });
  });

  it('RETRY_SHIP tetap dihitung menunggu pengiriman ulang', () => {
    expect(q({ externalStatus: 'RETRY_SHIP', hasAwb: true })).toMatchObject({ needsWork: true, bucket: 'sudahResi' });
  });

  // Inti perbaikan: IN_CANCEL dipetakan ke NEW internal, sehingga tanpa
  // `externalStatus` pesanan yang sedang dibatalkan pembeli ikut terhitung.
  it.each(['IN_CANCEL', 'UNPAID', 'PENDING', 'TO_RETURN', 'SHIPPED', 'TO_CONFIRM_RECEIVE', 'CANCELLED'])(
    'status Shopee %s tidak boleh masuk antrean kerja',
    (externalStatus) => {
      expect(q({ externalStatus }).needsWork).toBe(false);
    },
  );

  it('paket yang sudah dijemput kurir keluar dari antrean walau status pesanan masih PROCESSED', () => {
    expect(q({ externalStatus: 'PROCESSED', shipmentStatus: 'PICKED_UP', hasAwb: true }).needsWork).toBe(false);
  });

  it('tanpa status mentah (baris lama) memakai cadangan: resi menentukan kartu', () => {
    expect(q({ externalStatus: null, fulfillmentStatus: 'READY_TO_PICK' })).toMatchObject({
      needsWork: true,
      bucket: 'baru',
    });
    expect(
      q({ externalStatus: null, fulfillmentStatus: 'READY_TO_SHIP', shipmentStatus: 'READY_TO_SHIP', hasAwb: true }),
    ).toMatchObject({ needsWork: true, bucket: 'sudahResi' });
  });

  it('pesanan batal & selesai tidak pernah masuk antrean', () => {
    expect(q({ orderStatus: 'CANCELLED', externalStatus: 'CANCELLED' }).needsWork).toBe(false);
    expect(q({ orderStatus: 'COMPLETED', externalStatus: 'COMPLETED' }).needsWork).toBe(false);
  });

  it('kartu baru + sudah resi = perlu diproses (tanpa sisa)', () => {
    const daftar = [
      q(),
      q({ externalStatus: 'PROCESSED', hasAwb: true }),
      q({ externalStatus: 'IN_CANCEL' }),
      q({ orderStatus: 'COMPLETED', externalStatus: 'COMPLETED' }),
    ];
    const baru = daftar.filter((e) => belongsToBucket('baru', e));
    const sudahResi = daftar.filter((e) => belongsToBucket('sudahResi', e));
    const perlu = daftar.filter((e) => belongsToBucket('perluDiproses', e));

    expect(baru).toHaveLength(1);
    expect(sudahResi).toHaveLength(1);
    expect(perlu).toHaveLength(baru.length + sudahResi.length);
  });

  it('bucket "semua" dipakai untuk menampilkan pesanan final juga', () => {
    expect(belongsToBucket('semua', q({ orderStatus: 'CANCELLED', externalStatus: 'CANCELLED' }))).toBe(true);
  });

  it('countBuckets menjumlahkan sesuai definisi kartu', () => {
    const entries = [
      q(),
      q(),
      q({ externalStatus: 'PROCESSED', hasAwb: true }),
      q({ orderStatus: 'COMPLETED', externalStatus: 'COMPLETED' }),
    ];
    expect(countBuckets(entries)).toEqual({ perluDiproses: 3, pesananBaru: 2, sudahResi: 1 });
  });
});
