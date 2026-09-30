# Architecture Documentation

## C4 approach
Use C4 for system context, container and component communication. C4 intentionally focuses on different levels of architectural abstraction and can be supplemented by workflow/state/ER diagrams where needed.

## 1. System context

```text
[Owner] --------\
[Supervisor] ----> [E-Fulfill Hub] <---- [Warehouse Operator]
[Admin] --------/          |
                            |
                            v
                    [Marketplace Platform]
                            |
                            v
                      [Courier/Logistics]
```

## 2. Container view

```text
Users
  |
  v
Web Application
  |
  +--> Application/API
  |      |
  |      +--> Order Module
  |      +--> Inventory Module
  |      +--> Fulfillment Module
  |      +--> Shipping Module
  |      +--> Return Module
  |      +--> Configuration Module
  |      +--> Audit Module
  |
  +--> PostgreSQL
  |
  +--> Job Worker
  |      |
  |      +--> Integration Adapters
  |
  +--> External Marketplace API
```

## 3. Component principle
Components should be organized by business capability, not by technical type only.

Avoid:
```text
controllers/
services/
models/
utils/
```
as one giant global structure.

Prefer:
```text
modules/orders/domain
modules/orders/application
modules/orders/infrastructure
modules/orders/presentation
```

## 4. Deployment
MVP can be deployed as:
- web application
- worker process
- PostgreSQL
- reverse proxy
- HTTPS
- optional Redis/queue when justified

Do not introduce Kubernetes for the MVP.

## 5. Architecture review
Every diagram must have:
- title
- scope
- legend where needed
- named elements
- labelled relationships
- technology choices where relevant

These practices align with the C4 review guidance.
