# Fulfillment Rules

## 1. Order lifecycle

```text
NEW
 ↓
CONFIRMED
 ↓
STOCK_CHECK
 ├── insufficient → WAITING_STOCK
 └── sufficient
       ↓
STOCK_RESERVED
       ↓
READY_TO_PICK
       ↓
PICKING
       ↓
PICKED
       ↓
PACKING
       ↓
PACKED
       ↓
READY_TO_SHIP
       ↓
HANDED_OVER
       ↓
COMPLETED
```

Exceptions can move to `EXCEPTION` with a reason.

## 2. Stock calculation

Conceptually:
`available = on_hand - reserved - blocked`

The exact treatment of damaged/in-transit quantities must be represented explicitly rather than hidden inside one stock number.

## 3. Reservation
When reservation is enabled:
1. validate order eligibility;
2. identify fulfillment warehouse;
3. lock/recheck relevant inventory;
4. verify available quantity;
5. create reservation;
6. update reserved quantity;
7. write audit/inventory reference;
8. commit atomically.

## 4. Priority
Priority is not merely order date sorting.

Recommended criteria:
- time remaining to ship deadline
- SLA risk
- order age
- stock readiness
- operational constraints

The criteria and weights must be configurable and versioned.

## 5. Explainability
Every priority result must be explainable.

Example:
`CRITICAL because ship deadline is <2h and order is fully stock-ready.`

## 6. Scanning
Scan input can be:
- barcode
- QR code
- keyboard scanner
- camera

Scan must resolve to a known SKU/order reference.

Validation:
1. identify expected item;
2. compare scanned SKU;
3. compare quantity;
4. record scan event;
5. reject mismatch with actionable feedback.

## 7. Packing
Packing can be completed only when required picking conditions are satisfied.

Tenant setting:
`require_item_scan = true/false`

## 8. Shipment readiness
`READY_TO_SHIP` means internal fulfillment conditions are complete.
It must not be interpreted as carrier acceptance.

## 9. Returns
Return:
`REQUESTED → RECEIVED → INSPECTION`

Inspection outcomes:
- SELLABLE → restock
- DAMAGED → damaged stock
- PARTIAL → quantity-specific outcome
- REJECTED → no restock

## 10. Negative stock
Default:
`disabled`

If enabled for a tenant, it must:
- be explicit;
- be audited;
- be visible;
- not bypass reservation correctness.

## 11. Configuration
Tenant settings may include:
- reservation enabled
- negative stock enabled
- required item scan
- required packing confirmation
- priority thresholds
- warning threshold
- critical threshold
- warehouse selection policy
- return QC requirement
