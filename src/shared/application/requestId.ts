import { randomUUID } from 'crypto';

/**
 * Generate a short request ID for correlation / tracing.
 * Uses crypto.randomUUID for uniqueness.
 */
export function generateRequestId(): string {
  return randomUUID();
}
