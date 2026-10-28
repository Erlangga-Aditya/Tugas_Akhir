import { describe, expect, it } from 'vitest';
import { shouldAdvanceShipmentStatus } from './sync.service';

/**
 * Regresi untuk keluhan nyata: "Lacak Kiriman" tidak pernah menampilkan paket
 * yang sedang di perjalanan maupun pesanan yang sudah diterima pembeli.
 *
 * Sebabnya dua sumber kabar status saling menimpa. Setiap putaran auto-sync
 * menjalankan sinkron pesanan lebih dulu (membaca `order_status` pesanan, yang
 * menaikkan status ke "di perjalanan" saat Shopee mengirim `SHIPPED`), lalu
 * sinkron pelacakan (membaca `logistics_status` dari get_tracking_info, yang
 * di sandbox tetap `LOGISTICS_REQUEST_CREATED`).
 *
 * Akibatnya kabar maju langsung ditarik mundur ke "siap dikirim" satu detik
 * kemudian, dan status paket tidak pernah berkembang.
 */
describe('status pengiriman hanya boleh maju', () => {
  it('kabar yang tertinggal tidak menarik status mundur', () => {
    // Inilah kasus yang terjadi di produksi setiap 60 detik.
    expect(shouldAdvanceShipmentStatus('IN_TRANSIT', 'READY_TO_SHIP')).toBe(false);
    expect(shouldAdvanceShipmentStatus('PICKED_UP', 'READY_TO_SHIP')).toBe(false);
    expect(shouldAdvanceShipmentStatus('DELIVERED', 'IN_TRANSIT')).toBe(false);
  });

  it('kabar maju tetap diterapkan', () => {
    expect(shouldAdvanceShipmentStatus('READY_TO_SHIP', 'PICKED_UP')).toBe(true);
    expect(shouldAdvanceShipmentStatus('READY_TO_SHIP', 'IN_TRANSIT')).toBe(true);
    expect(shouldAdvanceShipmentStatus('IN_TRANSIT', 'DELIVERED')).toBe(true);
  });

  it('status yang sama tidak dianggap mundur', () => {
    expect(shouldAdvanceShipmentStatus('READY_TO_SHIP', 'READY_TO_SHIP')).toBe(true);
  });

  it('gagal dan dikembalikan selalu berlaku, dari keadaan mana pun', () => {
    // Keadaan luar biasa tidak boleh tertahan oleh urutan maju: paket yang
    // gagal kirim harus tetap bisa ditandai gagal walau statusnya sudah maju.
    expect(shouldAdvanceShipmentStatus('IN_TRANSIT', 'FAILED')).toBe(true);
    expect(shouldAdvanceShipmentStatus('DELIVERED', 'RETURNED')).toBe(true);
  });

  it('setelah gagal, kabar lama tidak menggeser statusnya', () => {
    expect(shouldAdvanceShipmentStatus('FAILED', 'IN_TRANSIT')).toBe(false);
    expect(shouldAdvanceShipmentStatus('RETURNED', 'DELIVERED')).toBe(false);
  });

  it('pembatalan hanya sah selama paket belum keluar gudang', () => {
    // Pesanan batal sebelum dijemput kurir → paketnya memang tidak pernah ada.
    expect(shouldAdvanceShipmentStatus('READY_TO_SHIP', 'CANCELLED')).toBe(true);
    expect(shouldAdvanceShipmentStatus('PENDING', 'CANCELLED')).toBe(true);

    // Paket yang SUDAH dijemput/di jalan tidak boleh "dibatalkan": barangnya
    // nyata-nyata keluar gudang. Jalur yang benar adalah retur, bukan pembatalan.
    expect(shouldAdvanceShipmentStatus('PICKED_UP', 'CANCELLED')).toBe(false);
    expect(shouldAdvanceShipmentStatus('IN_TRANSIT', 'CANCELLED')).toBe(false);
    expect(shouldAdvanceShipmentStatus('DELIVERED', 'CANCELLED')).toBe(false);
  });

  it('paket batal tidak bisa dihidupkan lagi oleh kabar terlambat', () => {
    expect(shouldAdvanceShipmentStatus('CANCELLED', 'PICKED_UP')).toBe(false);
    expect(shouldAdvanceShipmentStatus('CANCELLED', 'IN_TRANSIT')).toBe(false);
    expect(shouldAdvanceShipmentStatus('CANCELLED', 'FAILED')).toBe(false);
  });
});
