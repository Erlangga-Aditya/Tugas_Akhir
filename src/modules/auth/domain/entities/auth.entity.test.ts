import { describe, it, expect } from 'vitest';
import { hasPermission, hasMinimumRole, type AuthContext } from './auth.entity';
import type { UserRole } from './auth.entity';
import { PERMISSION_KEYS, can, type Permission } from '../permissions';

const owner = { role: 'OWNER' as UserRole, permissions: [] as Permission[] };
const staffAll = { role: 'STAFF' as UserRole, permissions: [...PERMISSION_KEYS] as Permission[] };
const staffNone = { role: 'STAFF' as UserRole, permissions: [] as Permission[] };

/**
 * Izin menggantikan role tunggal.
 *
 * Dua aturan yang harus selalu berlaku:
 *  - OWNER tidak pernah terkunci (owner yang menentukan izin).
 *  - Staff hanya boleh apa yang dicentang owner — tidak lebih, tidak kurang.
 *    "Tidak punya izin" berarti tidak punya akses sama sekali, bukan akses
 *    baca saja.
 */
describe('Penegakan izin', () => {
  it('OWNER selalu boleh, walau daftarnya kosong', () => {
    expect(hasPermission(owner, 'team.manage')).toBe(true);
    expect(hasPermission(owner, 'page.finance')).toBe(true);
    expect(hasPermission(owner, 'order.cancel')).toBe(true);
  });

  it('staff tanpa izin ditolak untuk semua halaman dan aksi', () => {
    for (const key of PERMISSION_KEYS) {
      expect(hasPermission(staffNone, key)).toBe(false);
    }
  });

  it('staff hanya boleh yang dicentang, tidak lebih', () => {
    const staff = {
      role: 'STAFF' as UserRole,
      permissions: ['page.orders', 'order.pick'] as Permission[],
    };
    expect(hasPermission(staff, 'page.orders')).toBe(true);
    expect(hasPermission(staff, 'order.pick')).toBe(true);
    expect(hasPermission(staff, 'page.inventory')).toBe(false);
    expect(hasPermission(staff, 'order.handover')).toBe(false);
  });

  it('izin yang dicentang lengkap memberi akses penuh', () => {
    for (const key of PERMISSION_KEYS) {
      expect(hasPermission(staffAll, key)).toBe(true);
    }
  });

  it('peran asing tidak lolos walau string-nya cocok (fail-closed)', () => {
    // Token lama atau data rusak bisa membawa role yang tidak dikenal.
    // Perbandingan string tidak boleh membuat akses nyasar.
    const rogue = { role: 'ADMIN', permissions: [...PERMISSION_KEYS] } as unknown as AuthContext;
    expect(hasPermission(rogue, 'page.orders')).toBe(false);
    expect(hasPermission(rogue, 'team.manage')).toBe(false);
  });
});

describe('Peran', () => {
  it('OWNER memenuhi syarat OWNER dan STAFF', () => {
    expect(hasMinimumRole('OWNER', 'OWNER')).toBe(true);
    expect(hasMinimumRole('OWNER', 'STAFF')).toBe(true);
  });

  it('STAFF hanya memenuhi syarat STAFF', () => {
    expect(hasMinimumRole('STAFF', 'STAFF')).toBe(true);
    expect(hasMinimumRole('STAFF', 'OWNER')).toBe(false);
  });

  it('peran asing tidak memenuhi syarat apa pun', () => {
    const rogue = 'MANAGER' as UserRole;
    expect(hasMinimumRole(rogue, 'OWNER')).toBe(false);
    expect(hasMinimumRole(rogue, 'STAFF')).toBe(false);
  });
});

describe('can() di domain murni', () => {
  it('menolak daftar izin null atau bukan array', () => {
    expect(can('STAFF', null, 'page.orders')).toBe(false);
    expect(can('STAFF', undefined, 'page.orders')).toBe(false);
    expect(can('STAFF', 'page.orders' as unknown as string[], 'page.orders')).toBe(false);
  });

  it('OWNER tetap lolos walau daftar izin rusak', () => {
    expect(can('OWNER', null, 'team.manage')).toBe(true);
  });
});
