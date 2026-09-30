/**
 * Resolusi konteks autentikasi — SATU sumber kebenaran yang dipakai proxy dan
 * route handler.
 *
 * Kenapa izin diambil dari database, bukan dari isi JWT:
 *
 * Izin ikut放进 JWT supaya route handler tidak perlu query database setiap
 * permintaan. Tapi itu membuat mencabut akses staff baru berlaku setelah token
 * kedaluwarsa atau staff logout — bisa 7 hari. Owner harus bisa mencabut akses
 * SEKARANG, karena "staf yang resign tidak boleh lagi masuk" itu keadaan yang
 * harus berlaku di detik yang sama.
 *
 * Solusinya: proxy (runtime Node.js, boleh menyentuh database) membaca izin
 * terbaru dari database lalu menuliskannya ke header internal. Route handler
 * memakai header itu dan tidak perlu query lagi.
 *
 * Yang dijaga di sini:
 *  - Header internal dihapus dari request masuk lebih dulu, jadi client tidak
 *    bisa menyamar jadi user lain lewat header buatan.
 *  - Akun yang sudah INACTIVE langsung ditolak, sehingga menonaktifkan staff
 *    menutup akses seketika, bukan menunggu token lama habis.
 */
import { prisma } from '@/shared/infrastructure/prisma';
import {
  PERMISSIONS,
  PERMISSION_KEYS,
  type Permission,
} from '@/modules/auth/domain/permissions';
import type { AuthContext } from '@/modules/auth/domain/entities/auth.entity';

/** Buang izin yang sudah tidak ada di registry, lalu urutkan agar stabil. */
export function normalizePermissions(raw: unknown): Permission[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is Permission => typeof p === 'string' && Object.hasOwn(PERMISSIONS, p))
    .sort();
}

/**
 * Baca user + membership terbaru, lalu kembalikan AuthContext yang jadi sumber
 * kebenaran. `null` bila akun tidak ada, sudah dinonaktifkan, atau tidak lagi
 * menjadi anggota tenant ini.
 */
export async function resolveAuthContext(params: {
  userId: string;
  tenantId: string;
}): Promise<AuthContext | null> {
  const membership = await prisma.tenantMembership.findFirst({
    where: { userId: params.userId, tenantId: params.tenantId },
    select: {
      role: true,
      permissions: true,
      user: { select: { email: true, status: true } },
    },
  });

  if (!membership) return null;
  if (membership.user.status !== 'ACTIVE') return null;

  return {
    userId: params.userId,
    email: membership.user.email,
    tenantId: params.tenantId,
    role: membership.role as AuthContext['role'],
    // OWNER mengabaikan kolom izin, jadi isi dari registry supaya bentuknya
    // sama dengan staff.
    permissions:
      membership.role === 'OWNER'
        ? [...PERMISSION_KEYS]
        : normalizePermissions(membership.permissions),
  };
}
