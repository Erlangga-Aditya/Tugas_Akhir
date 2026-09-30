/**
 * Structured logger for E-Fulfill Hub.
 * 
 * Rules (from 03-DESIGN.md §11 Observability, 10-SECURITY.md):
 * - Never log secrets, tokens, passwords.
 * - Always include correlationId/requestId when available.
 * - Include tenantId for operational traceability.
 * - Use structured JSON in production.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  requestId?: string;
  tenantId?: string;
  userId?: string;
  operation?: string;
  [key: string]: unknown;
}

function formatLog(level: LogLevel, message: string, context?: LogContext): string {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  };
  return JSON.stringify(entry);
}

function log(level: LogLevel, message: string, context?: LogContext): void {
  const isDevelopment = process.env.NODE_ENV === 'development';
  const isTest = process.env.NODE_ENV === 'test';

  if (isTest && level !== 'error') return; // suppress non-error in tests

  if (isDevelopment) {
    // Pretty print in dev
    const prefix = `[${level.toUpperCase()}]`;
    const timestamp = new Date().toISOString();
    const ctx = context ? ` ${JSON.stringify(context)}` : '';
    const consoleMethod =
      level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    consoleMethod(`${timestamp} ${prefix} ${message}${ctx}`);
  } else {
    // Structured JSON in production
    const output = formatLog(level, message, context);
    if (level === 'error') {
      process.stderr.write(output + '\n');
    } else {
      process.stdout.write(output + '\n');
    }
  }
}

export const logger = {
  debug: (message: string, context?: LogContext) => log('debug', message, context),
  info: (message: string, context?: LogContext) => log('info', message, context),
  warn: (message: string, context?: LogContext) => log('warn', message, context),
  error: (message: string, context?: LogContext) => log('error', message, context),
};
