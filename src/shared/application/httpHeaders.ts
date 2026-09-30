/**
 * Shared HTTP header names used by the proxy (auth context injection) and route
 * handlers (reading that context). Kept in a neutral module so neither the proxy
 * nor the route layer imports internals from the other.
 */
export const AUTH_CONTEXT_HEADER = 'x-auth-context';
export const REQUEST_ID_HEADER = 'x-request-id';
