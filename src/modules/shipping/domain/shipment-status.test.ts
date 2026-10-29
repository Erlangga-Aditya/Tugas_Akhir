import { describe, expect, it } from 'vitest';
import {
  mapOrderStatusToShipment,
  SHIPMENT_LEFT_WAREHOUSE,
  SHIPMENT_TERMINAL,
} from './shipment-status';

/**
 * Regresi keluhan nyata: "pesanan batal tampil 'Gagal kirim' di Lacak Kiriman".
 *
 * Akar masalahnya bukan tampilan: status PESANAN `CANCELLED` dipetakan menjadi
 * status PAKET `FAILED` saat sinkronisasi, sehingga datanya sendiri sudah salah
 * sebelum sampai ke layar. Test ini mengunci pemetaan yang benar.
 */
describe('mapOrderStatusToShipment', () => {
  it('pesanan batal → paket CANCELLED, bukan FAILED', () => {
    // Ini inti perbaikannya. `FAILED` berarti kurir gagal mengantar paket yang
    // benar-benar keluar gudang; pesanan batal tidak pernah punya paket.
    expect(mapOrderStatusToShipment('CANCELLED')).toBe('CANCELLED');
    expect(mapOrderStatusToShipment('cancelled')).toBe('CANCELLED');
    expect(mapOrderStatusToShipment('CANCELLED')).not.toBe('FAILED');
  });

  it('pembatalan yang baru DIAJUKAN tidak mengubah status paket', () => {
    // Paket masih bisa jadi dikirim kalau pengajuannya ditolak/kedaluwarsa.
    // `null` = jangan tulis apa pun (bukan "anggap di perjalanan").
    expect(mapOrderStatusToShipment('IN_CANCEL')).toBeNull();
  });

  it('belum dibayar bukan keadaan paket', () => {
    expect(mapOrderStatusToShipment('UNPAID')).toBeNull();
    expect(mapOrderStatusToShipment('PENDING')).toBeNull();
  });

  it('tahap persiapan kirim', () => {
    expect(mapOrderStatusToShipment('READY_TO_SHIP')).toBe('READY_TO_SHIP');
    expect(mapOrderStatusToShipment('PROCESSED')).toBe('READY_TO_SHIP');
    expect(mapOrderStatusToShipment('RETRY_SHIP')).toBe('READY_TO_SHIP');
  });

  it('tahap perjalanan & penerimaan', () => {
    expect(mapOrderStatusToShipment('SHIPPED')).toBe('IN_TRANSIT');
    // Paket sudah sampai, tinggal konfirmasi penerimaan.
    expect(mapOrderStatusToShipment('TO_CONFIRM_RECEIVE')).toBe('DELIVERED');
    expect(mapOrderStatusToShipment('COMPLETED')).toBe('DELIVERED');
  });

  it('retur dipisahkan dari gagal', () => {
    expect(mapOrderStatusToShipment('TO_RETURN')).toBe('RETURNED');
    expect(mapOrderStatusToShipment('RETURNED')).toBe('RETURNED');
  });

  it('status tak dikenal tidak ditebak (null, bukan IN_TRANSIT)', () => {
    // Versi lama memakai IN_TRANSIT sebagai default, sehingga pesanan yang
    // statusnya belum dikenal dicap "dalam perjalanan" tanpa dasar.
    expect(mapOrderStatusToShipment('SESUATU_YANG_BARU')).toBeNull();
    expect(mapOrderStatusToShipment(null)).toBeNull();
    expect(mapOrderStatusToShipment(undefined)).toBeNull();
    expect(mapOrderStatusToShipment('')).toBeNull();
  });

  /**
   * Regresi bug produksi: "Ambil Resi berhasil tetapi resi tidak muncul".
   *
   * `arrangeShipmentForOrder` dulu memanggil
   * `upsertShipment(..., 'LOGISTICS_REQUEST_CREATED')`. Itu status LOGISTIK,
   * sedangkan fungsi pemetaan ini hanya mengenal status PESANAN. Hasilnya
   * `null` → baris `shipments` tidak pernah dibuat, sehingga AWB yang sudah
   * diterbitkan Shopee tidak tampil di aplikasi.
   *
   * Test ini mengunci perilaku mapper sekaligus menjadi pengingat: JANGAN
   * mengirim status logistik ke sini. Simpan AWB lewat jalur yang menulis
   * status paket secara eksplisit (`saveArrangedShipment`).
   */
  it('status LOGISTIK bukan status pesanan (penyebab resi tidak tersimpan)', () => {
    expect(mapOrderStatusToShipment('LOGISTICS_REQUEST_CREATED')).toBeNull();
    expect(mapOrderStatusToShipment('LOGISTICS_READY')).toBeNull();
  });
});

describe('kelompok status paket', () => {
  it('paket batal BUKAN paket yang keluar gudang', () => {
    expect(SHIPMENT_LEFT_WAREHOUSE.has('CANCELLED')).toBe(false);
    expect(SHIPMENT_LEFT_WAREHOUSE.has('FAILED')).toBe(true);
  });

  it('paket batal bersifat final', () => {
    expect(SHIPMENT_TERMINAL.has('CANCELLED')).toBe(true);
    expect(SHIPMENT_TERMINAL.has('READY_TO_SHIP')).toBe(false);
  });
});
