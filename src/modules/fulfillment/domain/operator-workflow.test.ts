import { describe, expect, it } from 'vitest';
import { deriveOperatorWorkflow } from './operator-workflow';

describe('kontrak tahap kerja operator', () => {
  it('pesanan baru tanpa resi harus meminta pengaturan pengiriman lebih dulu', () => {
    expect(
      deriveOperatorWorkflow({ stage: 'BARU', hasAwb: false, hasShortfall: false }),
    ).toEqual({
      stage: 'BARU',
      nextAction: 'ARRANGE_SHIPMENT',
      canScan: false,
      canHandover: false,
    });
  });

  it('pesanan baru yang sudah punya resi harus masuk antrian kerja, bukan langsung scan', () => {
    expect(
      deriveOperatorWorkflow({ stage: 'BARU', hasAwb: true, hasShortfall: false }),
    ).toEqual({
      stage: 'BARU',
      nextAction: 'PROCESS_ORDER',
      canScan: false,
      canHandover: false,
    });
  });

  it('pesanan yang masuk antrian tetapi belum punya resi tetap ke arrange shipment', () => {
    expect(
      deriveOperatorWorkflow({ stage: 'BARU', hasAwb: false, hasShortfall: false }),
    ).toMatchObject({ nextAction: 'ARRANGE_SHIPMENT', canScan: false });
  });

  it('menunggu stok harus membuka jalur isi stok, bukan scan atau handover', () => {
    expect(
      deriveOperatorWorkflow({ stage: 'MENUNGGU_STOK', hasAwb: true, hasShortfall: true }),
    ).toEqual({
      stage: 'MENUNGGU_STOK',
      nextAction: 'ADD_STOCK',
      canScan: false,
      canHandover: false,
    });
  });

  it('siap dikemas dengan resi dan stok cukup hanya boleh scan resi sebagai langkah berikutnya', () => {
    expect(
      deriveOperatorWorkflow({ stage: 'SIAP_DIKEMAS', hasAwb: true, hasShortfall: false }),
    ).toEqual({
      stage: 'SIAP_DIKEMAS',
      nextAction: 'SCAN_AWB',
      canScan: true,
      canHandover: false,
    });
  });

  it('siap kirim setelah scan hanya boleh langkah menyerahkan ke kurir', () => {
    expect(
      deriveOperatorWorkflow({ stage: 'SIAP_KIRIM', hasAwb: true, hasShortfall: false }),
    ).toEqual({
      stage: 'SIAP_KIRIM',
      nextAction: 'HANDOVER',
      canScan: false,
      canHandover: true,
    });
  });

  it('sudah diserahkan ke kurir tidak menawarkan aksi operasi lagi', () => {
    expect(
      deriveOperatorWorkflow({ stage: 'DIKIRIM', hasAwb: true, hasShortfall: false }),
    ).toEqual({ stage: 'DIKIRIM', nextAction: 'NONE', canScan: false, canHandover: false });
  });
});
