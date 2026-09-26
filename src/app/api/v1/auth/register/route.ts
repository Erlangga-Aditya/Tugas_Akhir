import { type NextRequest } from 'next/server';
import { registerUser, RegisterSchema } from '@/modules/auth/application/auth.usecase';
import { signJwt, AUTH_COOKIE, sessionCookieOptions } from '@/modules/auth/infrastructure/jwt.service';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getRequestId } from '@/shared/application/routeHelpers';
import { ValidationError } from '@/shared/errors/AppError';

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const body: unknown = await request.json();
    const parsed = RegisterSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError('Data registrasi tidak valid.', { fields: parsed.error.flatten().fieldErrors });
    }

    const result = await registerUser(parsed.data);
    const token = await signJwt(result.context);

    const res = successResponse(
      {
        user: result.user,
        tenantId: result.context.tenantId,
        tenantName: result.tenantName,
        role: result.context.role,
      },
      { requestId, status: 201 },
    );
    res.cookies.set(AUTH_COOKIE, token, sessionCookieOptions());
    return res;
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
