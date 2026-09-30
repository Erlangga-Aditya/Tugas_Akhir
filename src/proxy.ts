import { type NextRequest, NextResponse } from 'next/server';
import { verifyJwt, AUTH_COOKIE } from '@/modules/auth/infrastructure/jwt.service';
import { AUTH_CONTEXT_HEADER } from '@/shared/application/httpHeaders';
import { hasPermission } from '@/modules/auth/domain/entities/auth.entity';
import { resolveAuthContext } from '@/modules/auth/application/resolveAuthContext';
import type { Permission } from '@/modules/auth/domain/permissions';
import type { AuthContext } from '@/modules/auth/domain/entities/auth.entity';

const PUBLIC_API = [
  '/api/v1/auth/login',
  '/api/v1/auth/logout',
  '/api/v1/health',
  '/api/v1/integrations/shopee/webhook',
  '/api/v1/integrations/shopee/callback',
];

function redirectToLogin(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  return NextResponse.redirect(url);
}

function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: { code: 'UNAUTHORIZED', message: 'Autentikasi diperlukan.' }, meta: { requestId: crypto.randomUUID() } },
    { status: 401 },
  );
}

/**
 * Authentication via httpOnly cookie (best practice — no XSS-exposed token).
 * - API: verifies cookie, injects verified auth context header.
 * - /dashboard pages: redirects unauthenticated users to /login.
 * - Sanitizes spoofable identity headers so tenant/user can never come from the client (FR-AUTH-003).
 */
/** Halaman & endpoint yang sengaja dihapus (seller individual). */
const REMOVED_PATHS = ['/register', '/api/v1/auth/register'];

/**
 * Peta path halaman → izin yang dibutuhkan untuk membukanya.
 *
 * Ini dicek di server, bukan cuma dengan menyembunyikan menunya. Menu yang
 * disembunyikan cuma kosmetik: tanpa penjaga di sini, siapa pun yang punya
 * cookie bisa mengetik URL halaman yang tidak diizinkan dan tetap melihat
 * datanya.
 */
const PAGE_GUARDS: readonly (readonly [prefix: string, permission: Permission])[] = [
  ['/dashboard/laporan-keuangan', 'page.finance'],
  ['/dashboard/integrasi', 'page.integrations'],
  ['/dashboard/pengaturan', 'page.settings'],
  ['/dashboard/kelola-tim', 'page.team'],
  ['/dashboard/pengembalian', 'page.returns'],
  ['/dashboard/laporan', 'page.reports'],
  ['/dashboard/pengiriman', 'page.shipping'],
  ['/dashboard/inventori', 'page.inventory'],
  ['/dashboard/produk', 'page.products'],
  ['/dashboard/pesanan', 'page.orders'],
  ['/dashboard', 'page.dashboard'],
];

/** Halaman yang tidak diizinkan → arahkan ke ringkasan, bukan 403 kosong. */
function deniedRedirect(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = '/dashboard';
  url.search = '?akses=ditolak';
  return NextResponse.redirect(url);
}

/**
 * Verifikasi cookie lalu terapkan izin terbaru dari database.
 *
 * Token hanya membuktikan "ini siapa", bukan "ini masih boleh". Yang kedua
 * harus dibaca dari database, kalau tidak mencabut akses tidak berlaku sampai
 * token kedaluwarsa.
 */
async function authenticate(
  request: NextRequest,
): Promise<{ ok: true; ctx: AuthContext } | { ok: false }> {
  const token = request.cookies.get(AUTH_COOKIE)?.value;
  if (!token) return { ok: false };

  let claims: AuthContext;
  try {
    claims = await verifyJwt(token);
  } catch {
    return { ok: false };
  }

  // resolveAuthContext mengembalikan null bila akun sudah dinonaktifkan atau
  // tidak lagi menjadi anggota tenant ini — dua-duanya berarti akses gugur.
  const ctx = await resolveAuthContext({ userId: claims.userId, tenantId: claims.tenantId });
  if (!ctx) return { ok: false };
  return { ok: true, ctx };
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Pendaftaran publik tidak ada. Akun hanya sah bila dibuat di Seller Centre
  // Shopee, jadi halaman dan endpointnya harus benar-benar mati, bukan sekadar
  // disembunyikan dari menu.
  if (REMOVED_PATHS.includes(pathname)) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Pendaftaran lewat aplikasi tidak tersedia.' }, meta: { requestId: crypto.randomUUID() } },
        { status: 404 },
      );
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Always strip spoofable identity headers.
  const headers = new Headers(request.headers);
  headers.delete(AUTH_CONTEXT_HEADER);
  headers.delete('x-tenant-id');
  headers.delete('x-user-id');

  if (pathname.startsWith('/api/v1/')) {
    if (PUBLIC_API.includes(pathname)) {
      return NextResponse.next({ request: { headers } });
    }
    const auth = await authenticate(request);
    if (!auth.ok) return unauthorized();
    headers.set(AUTH_CONTEXT_HEADER, JSON.stringify(auth.ctx));
    return NextResponse.next({ request: { headers } });
  }

  if (pathname.startsWith('/dashboard')) {
    const auth = await authenticate(request);
    if (!auth.ok) return redirectToLogin(request);
    // Halaman di luar daftar guard (mis. /dashboard/apa-saja) tetap boleh
    // untuk owner; untuk staff, daftar guard yang memegang kendali.
    if (auth.ctx.role !== 'OWNER') {
      const guard = PAGE_GUARDS.find(([prefix]) =>
        prefix === '/dashboard'
          ? pathname.startsWith('/dashboard/')
          : pathname === prefix || pathname.startsWith(prefix + '/'),
      );
      if (guard && !hasPermission(auth.ctx, guard[1])) {
        return deniedRedirect(request);
      }
    }
    headers.set(AUTH_CONTEXT_HEADER, JSON.stringify(auth.ctx));
    return NextResponse.next({ request: { headers } });
  }

  // Akar domain: pengguna yang sudah punya sesi tidak perlu melihat halaman
  // login lagi.
  if (pathname === '/') {
    const auth = await authenticate(request);
    if (!auth.ok) return redirectToLogin(request);
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/api/v1/:path*', '/dashboard/:path*', '/dashboard', '/', '/register', '/api/v1/auth/register'],
};
