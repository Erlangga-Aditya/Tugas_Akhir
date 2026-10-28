import { describe, expect, it } from 'vitest';
import { shouldCreateFulfillmentRecord } from './fulfillment-gate';

/**
 * Regresi: pesanan yang sudah ada di database lalu menjadi siap dikerjakan
 * (mis. `UNPAID` → `READY_TO_SHIP` setelah dibayar) tidak pernah mendapat
 * catatan fulfillment, karena versi lama hanya memproses pesanan yang BARU
 * diimpor (`result.created`). Akibatnya pesanan itu tidak muncul di antrean
 * kerja maupun daftar produksi.
 */
describe('gerbang pembuatan catatan fulfillment', () => {
  it('pesanan CONFIRMED yang belum punya catatan → dibuatkan', () => {
    expect(
      shouldCreateFulfillmentRecord({ orderStatus: 'CONFIRMED', hasActiveFulfillment: false }),
    ).toEqual({ shouldCreate: true });
  });

  it('idempoten: catatan yang sudah ada tidak dibuat ulang', () => {
    const hasil = shouldCreateFulfillmentRecord({
      orderStatus: 'CONFIRMED',
      hasActiveFulfillment: true,
    });
    expect(hasil.shouldCreate).toBe(false);
  });

  it('pesanan batal tidak dibuatkan antrean kerja', () => {
    expect(
      shouldCreateFulfillmentRecord({ orderStatus: 'CANCELLED', hasActiveFulfillment: false })
        .shouldCreate,
    ).toBe(false);
  });

  it('pesanan yang belum dibayar belum jadi pekerjaan gudang', () => {
    expect(
      shouldCreateFulfillmentRecord({ orderStatus: 'NEW', hasActiveFulfillment: false })
        .shouldCreate,
    ).toBe(false);
  });

  it('paket yang sudah keluar gudang tidak memunculkan antrean baru', () => {
    // Pesanan yang dikirim lewat Seller Centre: catatan fulfillment bisa
    // tertinggal, tetapi barangnya sudah pergi. Membuat antrean kerja di sini
    // akan menagih stok untuk barang yang tidak ada di rak.
    for (const status of ['PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'RETURNED']) {
      expect(
        shouldCreateFulfillmentRecord({
          orderStatus: 'CONFIRMED',
          shipmentStatus: status,
          hasActiveFulfillment: false,
        }).shouldCreate,
      ).toBe(false);
    }
  });

  it('paket yang masih menunggu kurir tetap boleh dibuatkan catatan', () => {
    // Resi sudah terbit tapi paket masih di gudang → pekerjaan gudang masih ada.
    expect(
      shouldCreateFulfillmentRecord({
        orderStatus: 'CONFIRMED',
        shipmentStatus: 'READY_TO_SHIP',
        hasActiveFulfillment: false,
      }).shouldCreate,
    ).toBe(true);
  });

  it('pesanan selesai tidak dibuatkan antrean baru', () => {
    expect(
      shouldCreateFulfillmentRecord({ orderStatus: 'COMPLETED', hasActiveFulfillment: false })
        .shouldCreate,
    ).toBe(false);
  });
});
