import { type NextRequest } from 'next/server';
import { AUTH_COOKIE, sessionCookieOptions } from '@/modules/auth/infrastructure/jwt.service';
import { successResponse } from '@/shared/application/apiResponse';
import { getRequestId } from '@/shared/application/routeHelpers';

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const res = successResponse({ ok: true }, { requestId });
  res.cookies.set(AUTH_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
  return res;
}
