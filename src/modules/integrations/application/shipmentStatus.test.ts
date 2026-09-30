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
});
