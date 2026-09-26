# Code Standards

## 1. Naming
Prefer explicit business names:
`ReserveStock`, `CalculateFulfillmentPriority`, `RegisterReturn`

Avoid vague:
`processData`, `handleThing`, `doStuff`.

## 2. Functions
Keep functions focused.
A function should have one clear reason to change.

## 3. Controllers
Controllers:
- authenticate
- authorize
- validate
- call use case
- serialize response

Controllers must not contain complex inventory/priority logic.

## 4. Services
Do not create a generic `UtilsService` or `CommonService` dumping ground.

Services should have a business responsibility.

## 5. Repositories
Repositories abstract persistence.
They should not contain UI logic or marketplace business rules.

## 6. ORM
ORM calls stay in infrastructure/persistence.
Domain entities must not depend on ORM models.

## 7. External API
Provider API client is infrastructure.
Provider response must be mapped before entering the application/domain layer.

## 8. Error handling
Use typed errors and central mapping.
Do not catch and ignore exceptions.

## 9. Database
- migrations are versioned;
- destructive schema changes require review;
- indexes are based on query patterns;
- foreign keys are explicit;
- unique constraints enforce identity rules.

## 10. Configuration
Business behavior that legitimately varies by tenant belongs in configuration.

But do not turn every constant into a database setting.
Configuration should exist only when variation is a real requirement.

## 11. Anti-spaghetti rules
Forbidden:
- cross-module database writes from random files;
- direct external API calls from UI;
- duplicated status transition logic;
- duplicated authorization checks with inconsistent behavior;
- hidden stock mutations;
- giant files mixing controller, domain, database and UI code.

## 12. Refactoring rule
When a module grows beyond understandable boundaries:
1. identify responsibility;
2. extract a domain/application component;
3. add tests;
4. migrate callers;
5. delete obsolete code.

Never "fix" spaghetti by adding another layer without clarifying responsibility.
