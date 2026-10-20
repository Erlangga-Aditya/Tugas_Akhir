import { describe, expect, it } from 'vitest';
import { deriveOperatorWorkflow, resolveOperatorStage } from './operator-workflow';

describe('kontrak tahap kerja operator', () => {
  it('pesanan baru tanpa resi harus meminta pengaturan pengiriman lebih dulu', () => {
    expect(
      deriveOperatorWorkflow({ stage: 'BARU', hasAwb: false, hasShortfall: false }),
    ).toMatchObject({
      stage: 'BARU',
      nextAction: 'ARRANGE_SHIPMENT',
      canArrangeShipment: true,
      canScan: false,
      canHandover: false,
      canSelectForBulk: true,
      isFinal: false,
    });
  });

  it('pesanan baru yang sudah punya resi harus masuk antrian kerja, bukan langsung scan', () => {
    expect(
      deriveOperatorWorkflow({ stage: 'BARU', hasAwb: true, hasShortfall: false }),
    ).toMatchObject({
      stage: 'BARU',
      nextAction: 'PROCESS_ORDER',
      canProcess: true,
      canScan: false,
      canHandover: false,
    });
  });

  it('menunggu stok harus membuka jalur isi stok, bukan scan atau handover', () => {
    expect(
      deriveOperatorWorkflow({ stage: 'MENUNGGU_STOK', hasAwb: true, hasShortfall: true }),
    ).toMatchObject({
      stage: 'MENUNGGU_STOK',
      nextAction: 'ADD_STOCK',
      canAddStock: true,
      canScan: false,
      canHandover: false,
    });
  });

  it('siap dikemas dengan resi dan stok cukup hanya boleh scan resi sebagai langkah berikutnya', () => {
    expect(
      deriveOperatorWorkflow({ stage: 'SIAP_DIKEMAS', hasAwb: true, hasShortfall: false }),
    ).toMatchObject({
      stage: 'SIAP_DIKEMAS',
      nextAction: 'SCAN_AWB',
      canScan: true,
      canHandover: false,
    });
  });

  it('siap kirim setelah scan hanya boleh langkah menyerahkan ke kurir', () => {
    expect(
      deriveOperatorWorkflow({ stage: 'SIAP_KIRIM', hasAwb: true, hasShortfall: false }),
    ).toMatchObject({
      stage: 'SIAP_KIRIM',
      nextAction: 'HANDOVER',
      canScan: false,
      canHandover: true,
      canPrintLabel: true,
    });
  });

  it('sudah diserahkan ke kurir tidak menawarkan aksi operasi lagi', () => {
    expect(
      deriveOperatorWorkflow({ stage: 'DIKIRIM', hasAwb: true, hasShortfall: false }),
    ).toEqual({
      stage: 'DIKIRIM',
      nextAction: 'NONE',
      canScan: false,
      canHandover: false,
      canArrangeShipment: false,
      canProcess: false,
      canAddStock: false,
      canPrintLabel: false,
      canSelectForBulk: false,
      isFinal: true,
    });
  });

  // Regresi yang dilaporkan klien: pesanan batal & pesanan yang sudah diterima
  // pembeli tetap menampilkan tombol "Ambil Resi" dan bisa dicentang untuk
  // operasi massal. Keduanya harus benar-benar tanpa aksi.
  it('pesanan dibatalkan tidak boleh menawarkan ambil resi, scan, atau pilih massal', () => {
    expect(
      deriveOperatorWorkflow({ stage: 'DIBATALKAN', hasAwb: false, hasShortfall: false }),
    ).toMatchObject({
      nextAction: 'NONE',
      canArrangeShipment: false,
      canScan: false,
      canHandover: false,
      canPrintLabel: false,
      canSelectForBulk: false,
      isFinal: true,
    });
  });

  it('pesanan yang sudah diterima pembeli tidak boleh menawarkan aksi apa pun walau tanpa resi', () => {
    expect(
      deriveOperatorWorkflow({ stage: 'SELESAI', hasAwb: false, hasShortfall: false }),
    ).toMatchObject({
      nextAction: 'NONE',
      canArrangeShipment: false,
      canScan: false,
      canHandover: false,
      canSelectForBulk: false,
      isFinal: true,
    });
  });
});

describe('resolveOperatorStage — satu sumber pemetaan status ke tahap', () => {
  it('pesanan batal selalu DIBATALKAN walau punya fulfillment dan resi', () => {
    expect(
      resolveOperatorStage({
        orderStatus: 'CANCELLED',
        fulfillmentStatus: 'READY_TO_SHIP',
        shipmentStatus: 'READY_TO_SHIP',
      }),
    ).toBe('DIBATALKAN');
  });

  it('pesanan selesai selalu SELESAI', () => {
    expect(
      resolveOperatorStage({
        orderStatus: 'COMPLETED',
        fulfillmentStatus: 'HANDED_OVER',
        shipmentStatus: 'DELIVERED',
      }),
    ).toBe('SELESAI');
  });

  it.each(['PICKED_UP', 'IN_TRANSIT', 'DELIVERED'] as const)(
    'status paket %s berarti sudah dikirim',
    (shipmentStatus) => {
      expect(
        resolveOperatorStage({
          orderStatus: 'CONFIRMED',
          fulfillmentStatus: 'READY_TO_SHIP',
          shipmentStatus,
        }),
      ).toBe('DIKIRIM');
    },
  );

  it('fulfillment HANDED_OVER tanpa status paket tetap dianggap sudah dikirim', () => {
    expect(
      resolveOperatorStage({
        orderStatus: 'CONFIRMED',
        fulfillmentStatus: 'HANDED_OVER',
        shipmentStatus: null,
      }),
    ).toBe('DIKIRIM');
  });

  it('belum masuk antrian fulfillment berarti BARU', () => {
    expect(
      resolveOperatorStage({ orderStatus: 'CONFIRMED', fulfillmentStatus: null, shipmentStatus: null }),
    ).toBe('BARU');
  });

  it('memetakan tahap kerja gudang sesuai status fulfillment', () => {
    const stage = (fulfillmentStatus: string) =>
      resolveOperatorStage({ orderStatus: 'CONFIRMED', fulfillmentStatus, shipmentStatus: 'READY_TO_SHIP' });

    expect(stage('WAITING_STOCK')).toBe('MENUNGGU_STOK');
    expect(stage('PACKED')).toBe('SIAP_KIRIM');
    expect(stage('READY_TO_SHIP')).toBe('SIAP_KIRIM');
    expect(stage('READY_TO_PICK')).toBe('SIAP_DIKEMAS');
    expect(stage('PICKED')).toBe('SIAP_DIKEMAS');
  });
});
