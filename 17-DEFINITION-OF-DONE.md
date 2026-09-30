# Definition of Ready / Definition of Done

## Definition of Ready
A feature is ready for implementation when:
- problem is stated;
- user role is known;
- acceptance criteria exist;
- business rules are explicit;
- data impact is understood;
- authorization impact is understood;
- integration impact is understood;
- test approach is defined.

## Definition of Done
A feature is done when:
- implementation follows module boundaries;
- validation exists;
- authorization exists;
- error states exist;
- unit tests exist for core business rules;
- integration/E2E test exists when applicable;
- audit behavior exists when material state changes occur;
- logs/observability exist for external operations;
- documentation is updated;
- no secrets are committed;
- lint/typecheck/build pass;
- migration is reviewed;
- backward compatibility is considered.

## PR checklist
- [ ] No business logic in UI
- [ ] No provider-specific logic in domain
- [ ] No tenant bypass
- [ ] No N+1 query introduced
- [ ] Pagination considered
- [ ] Transaction boundary reviewed
- [ ] Idempotency considered
- [ ] Error handling complete
- [ ] Tests updated
- [ ] Docs updated
