import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * Pengujian endpoint PATCH /api/v1/users/[userId] untuk fitur edit akun
 * staff oleh Owner (nama, email, password).
 *
 * Yang diuji:
 *  - Owner bisa mengubah nama, email, dan password staf.
 *  - Password di-hash bcrypt (tidak disimpan plain-text).
 *  - Email duplikat ditolak.
 *  - Password < 8 karakter ditolak.
 *  - Format email tidak valid ditolak.
 *  - Staf (tanpa izin team.manage) tidak boleh mengubah akun siapa pun.
 *  - Owner tidak boleh mengubah peran/status/izin akunnya sendiri.
 *  - Rate limit memblokir perubahan sensitif secara berlebihan.
 */

// ── Mock Prisma ────────────────────────────────────────────────────────
const userFindUnique = vi.fn();
const userUpdate = vi.fn();
const membershipFindFirst = vi.fn();
const membershipUpdate = vi.fn();

vi.mock('@/shared/infrastructure/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => userFindUnique(...args),
      update: (...args: unknown[]) => userUpdate(...args),
    },
    tenantMembership: {
      findFirst: (...args: unknown[]) => membershipFindFirst(...args),
      update: (...args: unknown[]) => membershipUpdate(...args),
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        user: {
          findUnique: (...args: unknown[]) => userFindUnique(...args),
          update: (...args: unknown[]) => userUpdate(...args),
        },
        tenantMembership: {
          update: (...args: unknown[]) => membershipUpdate(...args),
        },
      }),
  },
}));

// ── Mock auditLog (menulis ke DB) ──────────────────────────────────────
const auditLogSpy = vi.fn();
vi.mock('@/modules/audit/application/auditLog.service', () => ({
  auditLog: (...args: unknown[]) => auditLogSpy(...args),
}));

import { PATCH } from './route';

// ── Helper ─────────────────────────────────────────────────────────────
const OWNER_ID = 'owner-1';
const STAFF_ID = 'staff-1';
const TENANT_ID = 'tenant-1';

function makeRequest(body: unknown, ctx?: object): NextRequest {
  const headers = new Headers();
  if (ctx) {
    headers.set('x-auth-context', JSON.stringify(ctx));
  }
  return {
    url: 'http://localhost:3000/api/v1/users/staff-1',
    method: 'PATCH',
    json: async () => body,
    headers,
  } as unknown as NextRequest;
}

const ownerCtx = {
  userId: OWNER_ID,
  tenantId: TENANT_ID,
  role: 'OWNER',
  permissions: ['team.manage'],
};

const staffCtx = {
  userId: STAFF_ID,
  tenantId: TENANT_ID,
  role: 'STAFF',
  permissions: ['order.pack'],
};

function mockMembershipFound(role: 'OWNER' | 'STAFF' = 'STAFF') {
  membershipFindFirst.mockResolvedValue({
    id: 'membership-1',
    role,
    permissions: ['order.pack'],
    user: { id: STAFF_ID, name: 'Staf Packing', email: 'packing@toko.id' },
  });
}

async function runPatch(body: unknown, ctx?: object) {
  const res = await PATCH(makeRequest(body, ctx), { params: Promise.resolve({ userId: STAFF_ID }) });
  return { status: res.status, body: await res.json() };
}

describe('PATCH /api/v1/users/[userId] — edit akun oleh Owner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMembershipFound();
  });

  it('menolak staf yang tidak punya izin team.manage', async () => {
    const { status, body } = await runPatch({ name: 'Budi' }, staffCtx);

    expect(status).toBe(403);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('menolak request tanpa konteks autentikasi', async () => {
    const { status } = await runPatch({ name: 'Budi' });

    expect(status).toBe(401);
  });

  it('owner bisa mengubah nama staf', async () => {
    const { status, body } = await runPatch({ name: 'Budi' }, ownerCtx);

    expect(status).toBe(200);
    expect(body.data.updated).toBe(true);
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: STAFF_ID }, data: { name: 'Budi' } }),
    );
  });

  it('password di-hash bcrypt, bukan disimpan plain-text', async () => {
    const { status } = await runPatch({ password: 'PasswordBaru123' }, ownerCtx);

    expect(status).toBe(200);
    expect(userUpdate).toHaveBeenCalledTimes(1);

    const arg = userUpdate.mock.calls[0]?.[0] as { data: { passwordHash: string; passwordChangedAt: Date } };
    expect(arg.data.passwordHash).not.toBe('PasswordBaru123');
    // bcrypt hash selalu diawali $2a$, $2b$, atau $2y$.
    expect(arg.data.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(arg.data.passwordChangedAt).toBeInstanceOf(Date);
  });

  it('email baru disimpan dan dicek keunikkannya', async () => {
    userFindUnique.mockResolvedValue(null);

    const { status } = await runPatch({ email: 'budi@toko.id' }, ownerCtx);

    expect(status).toBe(200);
    expect(userFindUnique).toHaveBeenCalledWith({ where: { email: 'budi@toko.id' } });
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: STAFF_ID }, data: { email: 'budi@toko.id' } }),
    );
  });

  it('menolak email yang sudah dipakai akun lain', async () => {
    userFindUnique.mockResolvedValue({ id: 'user-lain' });

    const { status, body } = await runPatch({ email: 'budi@toko.id' }, ownerCtx);

    expect(status).toBe(400);
    expect(body.error?.code).toBe('VALIDATION_ERROR');
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('menolak password kurang dari 8 karakter', async () => {
    const { status } = await perubahanPasswordPendek();

    expect(status).toBe(400);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('menolak format email tidak valid', async () => {
    const { status } = await runPatch({ email: 'budi-bukan-email' }, ownerCtx);

    expect(status).toBe(400);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('menolak owner mengubah peran akunnya sendiri', async () => {
    const { status, body } = await runPatch(
      { role: 'STAFF' },
      { ...ownerCtx, userId: STAFF_ID },
    );

    expect(status).toBe(422);
    expect(body.error.code).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('mencatat perubahan ke audit log', async () => {
    await runPatch({ name: 'Budi', password: 'PasswordBaru123' }, ownerCtx);

    expect(auditLogSpy).toHaveBeenCalledTimes(1);
    const meta = auditLogSpy.mock.calls[0]?.[0] as {
      action: string;
      metadata: { name: string | null; passwordChanged: boolean | null };
    };
    expect(meta.action).toBe('user_update');
    expect(meta.metadata.name).toBe('Budi');
    expect(meta.metadata.passwordChanged).toBe(true);
  });

  it('rate limit memblokir perubahan sensitif yang terlalu sering', async () => {
    // 5 upaya pertama lolos (window 15 menit).
    for (let i = 0; i < 5; i += 1) {
      await runPatch({ password: `PasswordBaru123-${i}` }, ownerCtx);
    }
    // Upaya ke-6 harus diblokir.
    const { status, body } = await runPatch({ password: 'PasswordBaru123-x' }, ownerCtx);

    expect(status).toBe(403);
    expect(body.error.message).toMatch(/Terlalu banyak percobaan/i);
  });

  async function perubahanPasswordPendek() {
    return runPatch({ password: 'pendek' }, ownerCtx);
  }
});
