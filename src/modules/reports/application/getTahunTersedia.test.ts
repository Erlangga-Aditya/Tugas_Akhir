import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Test untuk `getTahunTersedia` — sumber dropdown tahun di halaman Laporan.
 *
 * Perilaku yang dikunci (commit tim f830963 tidak menyertakan test-nya):
 *  - Tidak ada data → hanya tahun berjalan (dropdown tetap bisa dipakai).
 *  - Ada data → rentang tahun data, SELALU mencakup tahun berjalan.
 *  - Query dibatasi tenant (anti IDOR), bukan seluruh database.
 */

const aggregate = vi.fn();

vi.mock('@/shared/infrastructure/prisma', () => ({
  prisma: {
    fulfillmentOrder: { aggregate: (...args: unknown[]) => aggregate(...args) },
  },
}));

import { getTahunTersedia } from './rekap-kerja-staf.usecase';

const tahunIni = new Date().getFullYear();

describe('getTahunTersedia', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tanpa data: hanya tahun berjalan', async () => {
    aggregate.mockResolvedValue({
      _min: { packedAt: null, handedOverAt: null },
      _max: { packedAt: null, handedOverAt: null },
    });

    await expect(getTahunTersedia('tenant-1')).resolves.toEqual({
      min: tahunIni,
      max: tahunIni,
    });
  });

  it('rentang data lebih lama: min dari data, max tetap tahun berjalan', async () => {
    aggregate.mockResolvedValue({
      _min: { packedAt: new Date('2023-05-02T03:00:00Z'), handedOverAt: null },
      _max: { packedAt: new Date('2024-08-11T03:00:00Z'), handedOverAt: null },
    });

    await expect(getTahunTersedia('tenant-1')).resolves.toEqual({
      min: 2023,
      max: tahunIni,
    });
  });

  it('memakai nilai paling awal dari kedua jenis kerjaan', async () => {
    aggregate.mockResolvedValue({
      _min: { packedAt: new Date('2024-01-02T00:00:00Z'), handedOverAt: new Date('2022-12-30T00:00:00Z') },
      _max: { packedAt: new Date('2025-02-02T00:00:00Z'), handedOverAt: new Date('2023-01-01T00:00:00Z') },
    });

    await expect(getTahunTersedia('tenant-1')).resolves.toEqual({
      min: 2022,
      max: tahunIni,
    });
  });

  it('query selalu dibatasi tenant pemanggil', async () => {
    aggregate.mockResolvedValue({
      _min: { packedAt: null, handedOverAt: null },
      _max: { packedAt: null, handedOverAt: null },
    });

    await getTahunTersedia('tenant-abc');

    const arg = (aggregate.mock.calls[0] as unknown[])[0] as { where: { order: { tenantId: string } } };
    expect(arg.where.order.tenantId).toBe('tenant-abc');
  });
});
