import { EventEmitter } from 'events';

// Global singleton EventEmitter across Next.js module reloads
const globalForSSE = globalThis as unknown as {
  __sseEmitter?: EventEmitter;
};

export const sseEmitter = globalForSSE.__sseEmitter ?? new EventEmitter();
sseEmitter.setMaxListeners(100);

if (process.env.NODE_ENV !== 'production') {
  globalForSSE.__sseEmitter = sseEmitter;
}

export interface SystemEventPayload {
  type: string;
  tenantId?: string;
  shopId?: string;
  orderId?: string;
  externalOrderId?: string;
  awb?: string;
  carrier?: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

/**
 * Broadcast an event to all connected SSE clients.
 */
export function broadcastSystemEvent(
  type: string,
  payload: Omit<SystemEventPayload, 'type' | 'timestamp'> & { data?: Record<string, unknown> } = {},
) {
  const event: SystemEventPayload = {
    type,
    timestamp: new Date().toISOString(),
    ...payload,
  };
  sseEmitter.emit('system-event', event);
}
