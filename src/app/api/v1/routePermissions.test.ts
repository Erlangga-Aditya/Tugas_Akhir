/**
 * Penjaga terakhir sistem hak akses.
 *
 * Test ini sengaja memindai berkas route yang sebenarnya, bukan daftar yang
 * ditulis tangan di sini. Daftar manual akan basi diam-diam:-route baru
 * ditambahkan tanpa penjaga, semua test tetap hijau, dan endpoint itu terbuka
 * untuk siapa pun yang punya cookie.
 *
 * Aturannya satu dan tidak bisa ditawar: setiap route yang memanggil
 * getAuthContext harus memanggil assertPermission dengan izin yang sama
 * banyak. Route publik (login, webhook, health) dikecualikan karena memang
 * tidak punya sesi.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { PERMISSION_KEYS } from '@/modules/auth/domain/permissions';

const API_ROOT = join(process.cwd(), 'src', 'app', 'api', 'v1');

/** Route yang memang tidak punya sesi: authenticate dulu, bukan "boleh semua". */
const PUBLIC = [
  'auth/login',
  'auth/logout',
  'auth/me',
  'health',
  'integrations/shopee/webhook',
  'integrations/shopee/callback',
  'integrations/shopee/health',
  'events/stream',
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name === 'route.ts') out.push(full);
  }
  return out;
}

const routes = walk(API_ROOT).map((full) => ({
  rel: relative(process.cwd(), full).split(sep).join('/'),
  src: readFileSync(full, 'utf8'),
}));

const protectedRoutes = routes.filter(
  (r) => !PUBLIC.some((p) => r.rel.includes(`/api/v1/${p}/`)),
);

describe('Setiap route API punya penjaga izin', () => {
  it('ada route untuk dipindai (kalau nol, pindainya salah)', () => {
    expect(protectedRoutes.length).toBeGreaterThan(30);
  });

  it.each(protectedRoutes.map((r) => [r.rel, r] as const))(
    '%s',
    (_name, route) => {
      const ctxCalls = route.src.split('getAuthContext(request)').length - 1;
      const permCalls = route.src.split('assertPermission(ctx,').length - 1;
      expect(
        permCalls,
        `${route.rel} memanggil getAuthContext ${ctxCalls}x tapi assertPermission ${permCalls}x. ` +
          'Setiap jalur yang punya sesi wajib ditegakkan izinnya.',
      ).toBeGreaterThanOrEqual(ctxCalls);
    },
  );
});

describe('Izin yang dipakai route benar-benar ada', () => {
  it('tidak ada route yang memakai izin yang tidak terdaftar di registry', () => {
    const used = new Set<string>();
    for (const r of routes) {
      for (const m of r.src.matchAll(/assertPermission\(ctx,\s*'([^']+)'\)/g)) {
        used.add(m[1]!);
      }
    }
    // Test yang sama, kalau registry berubah, test ini ikut gagal — bukan diam.
    expect(used.size).toBeGreaterThan(5);
    for (const key of used) {
      expect(PERMISSION_KEYS, `route memakai izin tak dikenal: ${key}`).toContain(key);
    }
  });
});

describe('Izin sensitif hanya dipakai di tempat yang tepat', () => {
  it('team.manage hanya muncul di route pengguna', () => {
    // Izin yang mengubah akses orang lain hanya boleh muncul di route
    // pengguna. Kalau muncul di route lain, ada jalan lain untuk menaikkan
    // hak akses tanpa lewat owner.
    for (const r of protectedRoutes) {
      const used = [...r.src.matchAll(/assertPermission\(ctx,\s*'([^']+)'\)/g)].map((m) => m[1]);
      if (used.includes('team.manage')) {
        expect(r.rel).toMatch(/api\/v1\/users\//);
      }
    }
  });
});
