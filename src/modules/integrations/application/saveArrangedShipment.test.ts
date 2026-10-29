import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regresi bug produksi: "Ambil Resi berhasil, tetapi resi tidak muncul".
 *
 * Akar masalah: `arrangeShipmentForOrder` menyimpan AWB lewat
 * `upsertShipment(..., 'LOGISTICS_REQUEST_CREATED')`. Fungsi itu memetakan
 * status PESANAN (`mapOrderStatusToShipment`), dan `LOGISTICS_REQUEST_CREATED`
 * tidak dikenal → `null` → TIDAK ADA baris `shipments` yang ditulis. Akibatnya
 * AWB yang sudah diterbitkan Shopee hilang dari aplikasi.
 *
 * Perbaikannya: jalur simpan khusus (`saveArrangedShipment`) yang menulis
 * status paket secara EKSPLISIT (`READY_TO_SHIP`), dan tidak pernah menurunkan
 * paket yang sudah lebih maju.
 */

const orderFindFirst = vi.fn();
const shipmentFindFirst = vi.fn();
const shipmentCreate = vi.fn();
const shipmentUpdate = vi.fn();

vi.mock('@/shared/infrastructure/prisma', () => ({
  prisma: {
    order: {
      findFirst: (...args: unknown[]) => orderFindFirst(...args),
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
    },
    shipment: {
      findFirst: (...args: unknown[]) => shipmentFindFirst(...args),
      create: (...args: unknown[]) => shipmentCreate(...args),
      update: (...args: unknown[]) => shipmentUpdate(...args),
    },
  },
}));

import { saveArrangedShipment } from './sync.service';

describe('saveArrangedShipment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orderFindFirst.mockResolvedValue({ id: 'order-1' });
  });

  it('membuat baris shipment dengan status READY_TO_SHIP saat belum ada', async () => {
    shipmentFindFirst.mockResolvedValue(null);
    shipmentCreate.mockResolvedValue({ id: 'ship-1' });

    await saveArrangedShipment('tenant-1', 'order-1', 'SPX00112233', 'SPX Express');

    expect(shipmentCreate).toHaveBeenCalledTimes(1);
    const arg = (shipmentCreate.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown> };
    expect(arg.data).toMatchObject({
      orderId: 'order-1',
      awb: 'SPX00112233',
      carrier: 'SPX Express',
      status: 'READY_TO_SHIP',
    });
  });

  it('tidak menurunkan paket yang sudah lebih maju dari READY_TO_SHIP', async () => {
    shipmentFindFirst.mockResolvedValue({ id: 'ship-1', status: 'IN_TRANSIT', awb: 'SPX00112233', carrier: null });
    shipmentUpdate.mockResolvedValue({ id: 'ship-1' });

    await saveArrangedShipment('tenant-1', 'order-1', 'SPX00112233', null);

    expect(shipmentUpdate).toHaveBeenCalledTimes(1);
    const arg = (shipmentUpdate.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown> };
    expect(arg.data.status).toBeUndefined();
    expect(arg.data.awb).toBe('SPX00112233');
  });

  it('mengisi AWB pada baris shipment yang sudah ada tanpa AWB', async () => {
    shipmentFindFirst.mockResolvedValue({ id: 'ship-1', status: 'PENDING', awb: null, carrier: null });
    shipmentUpdate.mockResolvedValue({ id: 'ship-1' });

    await saveArrangedShipment('tenant-1', 'order-1', 'SPX999', null);

    const arg = (shipmentUpdate.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown> };
    expect(arg.data.awb).toBe('SPX999');
    expect(arg.data.status).toBe('READY_TO_SHIP');
  });
});
