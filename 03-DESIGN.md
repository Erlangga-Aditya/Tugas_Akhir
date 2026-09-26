# Technical Design

## 1. Recommended architectural style
Use a modular monolith for the first implementation.

Do NOT start with microservices.

Why:
- A single student/team project has lower operational overhead.
- Domains remain separated by modules.
- Modules can later be extracted if scale actually requires it.
- Easier local development, testing and deployment.
- Avoids distributed transaction complexity during the research project.

## 2. Clean architecture boundary

```text
Presentation
    ↓
Application
    ↓
Domain
    ↑
Infrastructure
```

### Presentation
HTTP controllers/routes, request validation, authentication context, serialization.

### Application
Use cases/orchestration:
- ImportOrders
- ReserveStock
- CalculatePriority
- CreatePickingTask
- ConfirmScan
- CompletePacking
- RegisterReturn
- SynchronizeShipment

### Domain
Business entities, value objects, policies, invariants, domain services.

### Infrastructure
Database repositories, marketplace adapters, queues, cache, logging, external HTTP clients.

## 3. Dependency rule
Domain must not import:
- React
- Next.js
- Express
- Prisma/ORM
- Shopee SDK
- database clients
- HTTP clients

Application may depend on domain abstractions.
Infrastructure implements interfaces required by application/domain.

## 4. Suggested module layout

```text
src/
  modules/
    auth/
    tenants/
    catalog/
    inventory/
    orders/
    fulfillment/
    shipping/
    returns/
    integrations/
    reporting/
    audit/
    configuration/
  shared/
    domain/
    application/
    infrastructure/
    errors/
    observability/
  app/
    api/
    web/
```

Each module:

```text
orders/
  domain/
    entities/
    value-objects/
    policies/
    repositories/
  application/
    commands/
    queries/
    dto/
  infrastructure/
    persistence/
    mappers/
  presentation/
    http/
```

## 5. Transaction boundaries
Use database transactions for operations that must preserve invariants:
- reserve stock
- release reservation
- confirm picking where stock state changes
- return restock
- stock adjustment

Do not keep database transactions open while calling external APIs.

## 6. External integration rule
Never call the marketplace API directly from a controller.

Bad:
Controller → Shopee SDK → DB → business logic

Good:
Controller → Application Use Case → Integration Port → Shopee Adapter

## 7. Async jobs
Use a job boundary for:
- order synchronization
- product synchronization
- shipment synchronization
- webhook processing
- retry operations
- report generation

## 8. State machine principle
Order/fulfillment status changes must go through explicit transition rules.

Example:
`READY_TO_PICK → PICKING → PICKED → PACKING → PACKED → READY_TO_SHIP`

Invalid transitions are rejected.

## 9. Configuration principle
Use configuration tables for tenant-specific operational rules.

Do not create code like:
`if sellerId === "ABC" ...`

Instead:
`tenant.settings.fulfillment.requireItemScan`

## 10. Error model
Use typed/domain errors:
- ValidationError
- AuthorizationError
- ConflictError
- NotFoundError
- ExternalIntegrationError
- BusinessRuleViolation
- IdempotencyConflict

Map them to stable HTTP responses at the presentation layer.

## 11. Observability
Every integration operation should have:
- correlation ID
- tenant ID
- operation type
- external request/event ID when available
- start/end time
- outcome
- retry count
- error classification

Never log secrets or access tokens.
