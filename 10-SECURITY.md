# Security Baseline

## Target
OWASP ASVS Level 2 is the baseline target for the business web application.

## Authentication
- Strong password policy if local authentication is used.
- Secure session/token handling.
- Session expiration and revocation strategy.
- MFA can be future P1/P2 depending on scope.

## Authorization
- Deny by default.
- Verify tenant membership server-side.
- Verify role and resource ownership.
- Never trust tenant/user IDs from the browser.

## Input validation
- Validate every external input.
- Validate JSON structure and content type.
- Reject unexpected fields where appropriate.
- Normalize/validate barcode and identifiers.

## API security
- HTTPS only in production.
- Authentication on protected endpoints.
- Authorization per request.
- Rate limit sensitive endpoints.
- Consistent error responses.
- No stack traces in production.

## Secrets
Never store:
- provider tokens
- database passwords
- signing keys
- encryption keys

in source code or frontend bundles.

## Logging
Log:
- request ID
- actor
- tenant
- operation
- outcome
- error category

Do not log:
- passwords
- access tokens
- refresh tokens
- sensitive secret material

## Business logic security
Protect:
- stock manipulation
- reservation manipulation
- role changes
- integration connection
- bulk operations
- return restocking
- audit log integrity

## Threat scenarios
1. Cross-tenant data access.
2. Unauthorized inventory adjustment.
3. Replay of external webhook.
4. Duplicate order import.
5. Token leakage.
6. IDOR on order/inventory endpoints.
7. Mass assignment.
8. SQL injection/unsafe query construction.
9. XSS in notes/customer data.
10. CSRF where cookie-based auth is used.
11. Excessive API requests.
12. Malicious barcode/input payload.

## Verification
Use OWASP ASVS as a verification checklist rather than claiming generic "OWASP compliant".
