/**
 * Test untuk resolver konteks autentikasi.
 *
 * Fokusnya satu: izin harus dibaca dari database, bukan dari isi JWT. Kalau
 * ini berbalik, mencabut akses staff baru berlaku setelah token kedaluwarsa —
 * bug yang tidak terlihat di test HTTP manapun karena keduanya terlihat "benar"
 * selama token masih hidup.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const findFirst = vi.fn();
vi.mock('@/shared/infrastructure/prisma', () => ({
  prisma: { tenantMembership: { findFirst } },
}));

const { resolveAuthContext, normalizePermissions } = await import('./resolveAuthContext');
const { PERMISSION_KEYS, DEFAULT_STAFF_PERMISSIONS } = await import(
  '../domain/permissions'
);

function membership(over: Record<string, unknown> = {}) {
  return {
    role: 'STAFF',
    permissions: ['page.orders', 'order.pick'],
    user: { email: 'staff@toko.id', status: 'ACTIVE' },
    ...over,
  };
}

describe('normalizePermissions', () => {
  it('membuang izin yang sudah tidak dikenal', () => {
    expect(normalizePermissions(['page.orders', 'page.dunia', 42, null])).toEqual(['page.orders']);
  });

  it('mengurutkan agar perbandingan stabil', () => {
    // Urutan alfabetis murni: 'o' (order) mendahului 'p' (page). Yang penting
    // hasilnya satu-satu dan tidak bergantung urutan masukan.
    expect(normalizePermissions(['page.orders', 'order.pick'])).toEqual(['order.pick', 'page.orders']);
  });

  it('menangani nilai rusak tanpa melempar', () => {
    expect(normalizePermissions(null)).toEqual([]);
    expect(normalizePermissions('page.orders')).toEqual([]);
  });
});

describe('resolveAuthContext', () => {
  beforeEach(() => findFirst.mockReset());

  it('mengambil izin dari database, bukan dari token', async () => {
    findFirst.mockResolvedValue(membership({ permissions: ['page.inventory'] }));
    const ctx = await resolveAuthContext({ userId: 'u1', tenantId: 't1' });
    // Token bisa saja masih membawa ["page.orders", "order.pick"]; yang dipakai
    // harus yang ada di database saat ini.
    expect(ctx?.permissions).toEqual(['page.inventory']);
  });

  it('membaca dengan userId dan tenantId dari token', async () => {
    findFirst.mockResolvedValue(membership());
    await resolveAuthContext({ userId: 'u1', tenantId: 't1' });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', tenantId: 't1' } }),
    );
  });

  it('OWNER mendapat seluruh izin dari registry, bukan dari kolom database', async () => {
    // Kolom izin OWNER sengaja kosong di database. Kalau resolver ikut
    // memperlakukannya, owner akan kehilangan akses setiap kali registry berubah.
    findFirst.mockResolvedValue(membership({ role: 'OWNER', permissions: [] }));
    const ctx = await resolveAuthContext({ userId: 'o1', tenantId: 't1' });
    expect(ctx?.permissions).toEqual([...PERMISSION_KEYS]);
  });

  it('akun nonaktif ditolak: akses harus gugur seketika', async () => {
    findFirst.mockResolvedValue(membership({ user: { email: 'x@toko.id', status: 'INACTIVE' } }));
    expect(await resolveAuthContext({ userId: 'u1', tenantId: 't1' })).toBeNull();
  });

  it('membership yang sudah hilang ditolak', async () => {
    findFirst.mockResolvedValue(null);
    expect(await resolveAuthContext({ userId: 'u1', tenantId: 't1' })).toBeNull();
  });

  it('izin kosong dihormati, bukan diisi default', async () => {
    // Ini yang terjadi setelah owner mencabut akses. Kalau di sini muncul
    // default, pencabutan akses tidak akan pernah berlaku.
    findFirst.mockResolvedValue(membership({ permissions: [] }));
    const ctx = await resolveAuthContext({ userId: 'u1', tenantId: 't1' });
    expect(ctx?.permissions).toEqual([]);
  });

  it('izin di luar registry dibuang diam-diam', async () => {
    findFirst.mockResolvedValue(membership({ permissions: [...DEFAULT_STAFF_PERMISSIONS, 'page.dunia'] }));
    const ctx = await resolveAuthContext({ userId: 'u1', tenantId: 't1' });
    expect(ctx?.permissions).not.toContain('page.dunia');
  });
});
