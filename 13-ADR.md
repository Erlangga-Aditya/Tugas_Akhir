# Architecture Decision Records

## ADR-001 Modular Monolith
Status: Accepted

Decision:
Use a modular monolith for MVP.

Reason:
Lower operational complexity while preserving domain boundaries and future extraction options.

Rejected for MVP:
Microservices.

## ADR-002 Internal Domain Model
Status: Accepted

Decision:
Use internal entities independent from marketplace schemas.

Reason:
Prevents vendor lock-in and enables future marketplace adapters.

## ADR-003 Inventory Ledger
Status: Accepted

Decision:
Track material inventory changes through immutable movement records.

Reason:
Auditability, reconciliation and research traceability.

## ADR-004 Explicit State Machines
Status: Accepted

Decision:
Order/fulfillment/return states use explicit transition rules.

Reason:
Prevents invalid operational states.

## ADR-005 Priority Rules Are Configurable
Status: Accepted

Decision:
Priority criteria and weights are tenant-configurable and versioned.

Reason:
Different sellers have different SLA and operational constraints.

## ADR-006 External Integration Adapter
Status: Accepted

Decision:
External marketplace API access is isolated behind an adapter/port.

Reason:
Testability, maintainability and multi-channel extensibility.

## ADR-007 Async Synchronization
Status: Accepted

Decision:
Synchronization runs asynchronously where workload can be delayed safely.

Reason:
Protect interactive UX and isolate external API failures.

## ADR-008 No Microservices in MVP
Status: Accepted

Decision:
Do not split into microservices until measured scaling/ownership needs justify it.

## ADR-009 No AI as Core Novelty
Status: Accepted

Decision:
AI is not the primary novelty.

Reason:
Core research value is operational integration and explainable fulfillment prioritization. AI may be future work.

## ADR-010 Security Baseline
Status: Accepted

Decision:
Use OWASP ASVS Level 2 as the practical security verification baseline.
