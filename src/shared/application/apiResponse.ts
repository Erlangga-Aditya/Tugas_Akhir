import { type NextRequest, NextResponse } from 'next/server';
import { isAppError, type AppError } from '@/shared/errors/AppError';
import { logger } from '@/shared/observability/logger';
import { generateRequestId } from '@/shared/application/requestId';

// ────────────────────────────────────────────────────────────
// Standard response envelope (07-API-CONTRACT.md)
// ────────────────────────────────────────────────────────────

export interface ApiSuccessResponse<T> {
  data: T;
  meta: {
    requestId: string;
    pagination?: PaginationMeta;
  };
}

export interface PaginationMeta {
  total?: number;
  page?: number;
  pageSize?: number;
  nextCursor?: string | null;
  hasMore?: boolean;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  meta: {
    requestId: string;
  };
}

// ────────────────────────────────────────────────────────────
// Response builders
// ────────────────────────────────────────────────────────────

export function successResponse<T>(
  data: T,
  options: {
    requestId?: string;
    status?: number;
    pagination?: PaginationMeta;
  } = {},
): NextResponse<ApiSuccessResponse<T>> {
  const requestId = options.requestId ?? generateRequestId();
  return NextResponse.json(
    {
      data,
      meta: {
        requestId,
        ...(options.pagination ? { pagination: options.pagination } : {}),
      },
    },
    { status: options.status ?? 200 },
  );
}

export function errorResponse(
  code: string,
  message: string,
  options: {
    requestId?: string;
    status?: number;
    details?: Record<string, unknown>;
  } = {},
): NextResponse<ApiErrorResponse> {
  const requestId = options.requestId ?? generateRequestId();
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(options.details ? { details: options.details } : {}),
      },
      meta: { requestId },
    },
    { status: options.status ?? 500 },
  );
}

export function ok<T>(data: T, requestId?: string): NextResponse<ApiSuccessResponse<T>> {
  return successResponse(data, { requestId, status: 200 });
}

export function created<T>(data: T, requestId?: string): NextResponse<ApiSuccessResponse<T>> {
  return successResponse(data, { requestId, status: 201 });
}

// ────────────────────────────────────────────────────────────
// Central error handler for route handlers
// ────────────────────────────────────────────────────────────

export function handleRouteError(
  error: unknown,
  requestId?: string,
  req?: NextRequest,
): NextResponse<ApiErrorResponse> {
  const reqId = requestId ?? generateRequestId();
  if (isAppError(error)) {
    const appError = error as AppError;

    // Log at appropriate level
    if (appError.statusCode >= 500) {
      logger.error('Application error', {
        code: appError.code,
        message: appError.message,
        stack: appError.stack,
        requestId: reqId,
      });
    } else {
      logger.warn('Client error', {
        code: appError.code,
        message: appError.message,
        requestId: reqId,
      });
    }

    return errorResponse(appError.code, appError.message, {
      requestId: reqId,
      status: appError.statusCode,
      details: appError.details,
    });
  }

  // Unexpected error — never expose internals to client
  logger.error('Unexpected error', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    requestId: reqId,
    url: req?.url,
  });

  return errorResponse('INTERNAL_ERROR', 'Terjadi kesalahan internal. Silakan coba lagi.', {
    requestId: reqId,
    status: 500,
  });
}
