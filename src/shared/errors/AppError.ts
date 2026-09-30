/**
 * Typed application errors.
 * Controllers map these to appropriate HTTP responses.
 * Domain/Application layer throws these — NEVER throw raw Error with HTTP codes.
 */

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

// ────────────────────────────────────────────────────────────
// 400-range client errors
// ────────────────────────────────────────────────────────────

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Autentikasi diperlukan.') {
    super(message, 'UNAUTHORIZED', 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Anda tidak memiliki izin untuk melakukan tindakan ini.') {
    super(message, 'FORBIDDEN', 403);
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string, id?: string) {
    const msg = id ? `${entity} dengan ID ${id} tidak ditemukan.` : `${entity} tidak ditemukan.`;
    super(msg, 'NOT_FOUND', 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFLICT', 409, details);
  }
}

// ────────────────────────────────────────────────────────────
// Business rule violations
// ────────────────────────────────────────────────────────────

export class InsufficientStockError extends AppError {
  constructor(sku: string, available: number, requested: number) {
    super(
      `Stok tidak mencukupi untuk SKU ${sku}. Tersedia: ${available}, Diminta: ${requested}.`,
      'STOCK_INSUFFICIENT',
      409,
      { sku, available, requested },
    );
  }
}

export class InvalidStateTransitionError extends AppError {
  constructor(entity: string, from: string, to: string) {
    super(
      `Tidak dapat mengubah status ${entity} dari ${from} ke ${to}.`,
      'INVALID_STATE_TRANSITION',
      409,
      { entity, from, to },
    );
  }
}

export class IdempotencyConflictError extends AppError {
  constructor(key: string) {
    super(
      `Permintaan duplikat terdeteksi (idempotency key: ${key}).`,
      'IDEMPOTENCY_CONFLICT',
      409,
      { key },
    );
  }
}

export class BusinessRuleViolationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'BUSINESS_RULE_VIOLATION', 422, details);
  }
}

// ────────────────────────────────────────────────────────────
// Infrastructure / integration errors
// ────────────────────────────────────────────────────────────

export class ExternalIntegrationError extends AppError {
  constructor(provider: string, message: string, details?: Record<string, unknown>) {
    super(
      `Kesalahan integrasi dengan ${provider}: ${message}`,
      'EXTERNAL_INTEGRATION_ERROR',
      502,
      details,
    );
  }
}

// ────────────────────────────────────────────────────────────
// Type guard
// ────────────────────────────────────────────────────────────

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
