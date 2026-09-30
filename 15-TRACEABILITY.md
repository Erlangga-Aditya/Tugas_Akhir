# Requirements Traceability Matrix

| Requirement | Design | Implementation Module | Test |
|---|---|---|---|
| FR-INV-003 available stock | Domain Model | inventory | Unit + integration |
| FR-RES-001 reservation | Fulfillment Rules | inventory/orders | Unit + integration |
| FR-PRI-001 priority | Fulfillment Rules | priority | Unit + research test |
| FR-FUL-003 scan validation | UX + Fulfillment Rules | fulfillment | E2E |
| FR-RET-004 restock | Domain Model | returns/inventory | Integration |
| FR-INT-004 retryable sync | Integration Design | integrations/jobs | Integration |
| FR-AUD-001 audit | Security/Data Model | audit | Integration |
| NFR-SEC | Security | all protected APIs | Security tests |
| NFR-MAINT | Architecture | all modules | Code review |
| NFR-UX | UX | web | Usability test |

## Rule
No production feature should exist without:
1. requirement;
2. design decision;
3. implementation location;
4. test/acceptance criterion.

Research features additionally require:
5. measurable research variable or explicit justification for inclusion.
