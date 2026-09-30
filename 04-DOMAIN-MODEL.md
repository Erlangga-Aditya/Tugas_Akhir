# Domain Model

## 1. Bounded modules

### Identity & Tenant
Tenant, User, Role, Membership.

### Catalog
Product, ProductVariant, SKU, ExternalProductMapping.

### Inventory
Warehouse, InventoryBalance, InventoryMovement, StockReservation.

### Order
Order, OrderItem, OrderStatusHistory, SalesChannel.

### Fulfillment
FulfillmentOrder, PickingTask, PickingItem, PackingTask.

### Shipping
Shipment, ShipmentEvent, CarrierReference.

### Returns
Return, ReturnItem, ReturnInspection.

### Integration
IntegrationConnection, SyncRun, WebhookEvent, ExternalMapping.

### Configuration
FulfillmentPolicy, PriorityRule, TenantSetting.

### Audit
AuditLog.

## 2. Core invariants

### Inventory
`available = onHand - reserved - blocked`

All terms are non-negative unless an explicit negative-stock policy is enabled.

### Reservation
A reservation belongs to a specific order item and warehouse.
A reservation cannot be silently reassigned.

### Order identity
Internal order ID is independent of external marketplace order ID.

### External identity
External IDs are unique within a provider/shop scope, not globally assumed.

### Return
A return does not automatically become sellable stock. Inspection determines the inventory outcome.

## 3. Statuses
Prefer explicit enums/state machines rather than arbitrary strings.

Order:
- NEW
- CONFIRMED
- CANCELLED
- COMPLETED

Fulfillment:
- WAITING_STOCK
- READY_TO_PICK
- PICKING
- PICKED
- PACKING
- PACKED
- READY_TO_SHIP
- HANDED_OVER
- COMPLETED
- EXCEPTION

Return:
- REQUESTED
- IN_TRANSIT
- RECEIVED
- INSPECTION
- RESTOCKED
- DAMAGED
- REJECTED
- CLOSED

## 4. Priority explanation
Every calculated priority should have a machine-readable explanation, e.g.

```json
{
  "score": 82,
  "level": "CRITICAL",
  "ruleVersion": "priority-v1",
  "factors": [
    {"code": "DEADLINE_URGENT", "value": 0.9, "weight": 0.40},
    {"code": "SLA_RISK", "value": 0.8, "weight": 0.30},
    {"code": "STOCK_READY", "value": 1.0, "weight": 0.20},
    {"code": "ORDER_AGE", "value": 0.4, "weight": 0.10}
  ]
}
```

This makes the system explainable and research-friendly.
