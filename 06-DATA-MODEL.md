# Data Model

## Core tables

### tenants
- id
- name
- status
- created_at
- updated_at

### users
- id
- email
- password_hash/identity_reference
- status
- created_at

### tenant_memberships
- id
- tenant_id
- user_id
- role_id

### shops
- id
- tenant_id
- provider
- name
- external_shop_id
- status

### warehouses
- id
- tenant_id
- name
- code
- status

### products
- id
- tenant_id
- name
- status

### product_variants
- id
- product_id
- sku
- barcode
- name
- status

### external_product_mappings
- id
- shop_id
- variant_id
- external_product_id
- external_variant_id

### inventory_balances
- id
- warehouse_id
- variant_id
- on_hand
- reserved
- blocked
- version

Unique:
`warehouse_id + variant_id`

### inventory_movements
- id
- tenant_id
- warehouse_id
- variant_id
- movement_type
- quantity_delta
- reference_type
- reference_id
- reason
- actor_id
- created_at

### stock_reservations
- id
- warehouse_id
- variant_id
- order_item_id
- quantity
- status
- created_at
- released_at

### orders
- id
- tenant_id
- shop_id
- external_order_id
- status
- placed_at
- ship_by_at
- priority_score
- priority_level
- priority_rule_version

Unique:
`shop_id + external_order_id`

### order_items
- id
- order_id
- variant_id
- quantity
- fulfilled_quantity
- status

### order_status_history
- id
- order_id
- from_status
- to_status
- actor_id
- reason
- created_at

### fulfillment_orders
- id
- order_id
- warehouse_id
- status
- started_at
- completed_at

### picking_tasks
- id
- fulfillment_order_id
- status
- assigned_to
- started_at
- completed_at

### picking_items
- id
- picking_task_id
- variant_id
- expected_quantity
- picked_quantity

### shipments
- id
- order_id
- awb
- carrier
- status
- shipped_at
- delivered_at

### shipment_events
- id
- shipment_id
- external_event_id
- status
- occurred_at
- raw_reference
- created_at

Unique where supported:
`shipment_id + external_event_id`

### returns
- id
- order_id
- external_return_id
- status
- reason
- received_at

### return_items
- id
- return_id
- variant_id
- quantity
- inspection_result

### integration_connections
- id
- shop_id
- provider
- encrypted_credentials   (AES-256-GCM JSON blob: access_token, refresh_token, expiry, external_shop_id)
- sandbox
- status
- last_sync_at

Unique:
`shop_id + provider`

### sync_runs
- id
- shop_id
- operation
- started_at
- finished_at
- status
- records_read
- records_written
- error_code

### webhook_events
- id
- shop_id
- provider
- external_event_id
- event_type
- payload_hash
- processed_at
- status

### priority_rules
- id
- tenant_id
- version
- enabled
- criteria_json
- created_at

### audit_logs
- id
- tenant_id
- actor_id
- action
- entity_type
- entity_id
- metadata_json
- created_at

## Indexing baseline
Index:
- tenant_id on tenant-owned tables
- external IDs within provider/shop scope
- status fields used in operational queues
- ship_by_at
- warehouse_id + variant_id
- order_id foreign keys
- created_at on event/history tables

Avoid blindly indexing every column.
