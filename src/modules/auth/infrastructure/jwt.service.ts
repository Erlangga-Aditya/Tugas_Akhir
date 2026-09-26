import { SignJWT, jwtVerify } from 'jose';
import type { AuthContext } from '../domain/entities/auth.entity';
import { UnauthorizedError } from '@/shared/errors/AppError';

export const AUTH_COOKIE = 'efh_session';

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  // Fail fast — NEVER fall back to a hardcoded secret (10-SECURITY.md).
  if (!secret || secret.length < 32) {
    throw new Error(
      'JWT_SECRET belum disetel atau terlalu pendek (min 32 karakter). Setel di .env sebelum menjalankan aplikasi.',
    );
  }
  return new TextEncoder().encode(secret);
}

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '7d';

/** Parse "7d"/"4h"/"30m" into seconds (for cookie maxAge). */
export function jwtExpiresInSeconds(): number {
  const raw = JWT_EXPIRES_IN;
  const m = /^(\d+)([smhd])$/.exec(raw.trim());
  if (!m) return 60 * 60 * 24 * 7; // default 7d
  const n = parseInt(m[1]!, 10);
  switch (m[2]) {
    case 's': return n;
    case 'm': return n * 60;
    case 'h': return n * 60 * 60;
    default: return n * 60 * 60 * 24;
  }
}

export interface JwtPayload {
  sub: string;   // userId
  email: string;
  tenantId: string;
  role: string;
}

export async function signJwt(context: AuthContext): Promise<string> {
  return new SignJWT({
    sub: context.userId,
    email: context.email,
    tenantId: context.tenantId,
    role: context.role,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRES_IN)
    .sign(getJwtSecret());
}

export async function verifyJwt(token: string): Promise<AuthContext> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    const p = payload as unknown as JwtPayload;
    if (!p.sub || !p.email || !p.tenantId || !p.role) {
      throw new UnauthorizedError('Token tidak valid.');
    }
    return {
      userId: p.sub,
      email: p.email,
      tenantId: p.tenantId,
      role: p.role as AuthContext['role'],
    };
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    throw new UnauthorizedError('Token tidak valid atau telah kedaluwarsa.');
  }
}

/** httpOnly cookie options for the session JWT. */
export function sessionCookieOptions() {
  // Penanda "secure" HARUS mengikuti protokol alamat aplikasi, bukan sekadar mode
  // produksi: kalau aplikasi produksi diakses lewat HTTP (mis. uji lokal),
  // browser menolak cookie bertanda secure dan login seolah-olah gagal.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
  const secure = appUrl ? appUrl.startsWith('https://') : process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: jwtExpiresInSeconds(),
  };
}
