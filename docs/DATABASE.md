# Database Plan

Migrations in `supabase/migrations/` are the authoritative definition. This document is the map.

## Conventions

- Primary keys: `uuid default gen_random_uuid()`.
- `created_at timestamptz default now()`, `updated_at` maintained by trigger.
- Currency `numeric(12,2)`; quantities `numeric(14,4)`; unit costs `numeric(14,6)`.
- Enums for closed vocabularies (order status, movement type…); lookup tables for
  owner-configurable lists (categories, payment methods, expense categories, waste reasons).
- Human-readable sequential numbers (`SP-000123`) via `doc_counters` table + function, per doc type.
- Financial tables: no client INSERT/UPDATE/DELETE grants; RPC-only.

## Domains

### Identity & access (Phase 1)
- `profiles` — 1:1 with `auth.users`; full name, role, active flag, PIN hash (optional quick switch).
- `role_permissions` — (role, permission) rows; seeded defaults; owner-editable.
- `audit_logs` — append-only; user, action, entity, entity_id, before/after jsonb, reason, session info.
- `settings` — single-row jsonb-per-key store (business profile, tax config, receipt, loyalty rules,
  negative-stock policy, approval thresholds…). Sensitive keys owner-only via RLS + RPC.
- `doc_counters` — per-doc-type sequence for order/PO/receipt numbers.

### Catalog (Phase 2)
- `categories` — sellable navigation groups (Coffee, Meals, Convenience Store…), sort order, station default.
- `products` — unified sellable: `kind` = `prepared` | `retail`. Price, tax mode, image, station,
  prep minutes, availability, barcode/SKU (retail), linked inventory item (retail), archived_at.
- `product_variants` — e.g. Hot/Iced × sizes; each with price delta and optional own recipe scaling.
- `modifier_groups`, `modifier_options` — price delta + inventory effects
  (`adds` ingredient qty / `replaces` ingredient / `removes` ingredient), availability, station override.
- `product_modifier_groups` — attach groups to products.

### Units & inventory (Phase 2)
- `units` — canonical units (g, kg, ml, L, pc, pack, …) with kind (mass/volume/count).
- `inventory_items` — everything stocked: type (`ingredient`,`packaging`,`retail`,`prepared`,`supply`),
  base unit, purchase unit + conversion factor, reorder/target levels, weighted-average cost,
  latest cost, expiry-tracked flag, storage location, supplier default.
- `inventory_batches` — lot tracking: received date, expiry, qty remaining, unit cost, source ref.
- `inventory_movements` — the ledger. type, item, batch, qty (signed), unit cost, reference
  (type + id), user, reason, notes. Current stock = cached column on `inventory_items`
  updated in-transaction; `verify_stock_reconciliation()` checks cache vs ledger.
- `recipes` (1:1 with prepared product/variant) and `recipe_ingredients` — qty in base unit,
  waste %, required/optional, variant applicability.

### Sales (Phase 3)
- `orders` — number, type (`dine_in`,`takeaway`,`courtside`,`tab`), status
  (`open`,`held`,`completed`,`voided`,`cancelled`), customer, tab, courtside label, notes,
  subtotal/discount/tax/service/total (server-computed), tax config snapshot jsonb,
  shift, cashier, idempotency key.
- `order_items` — product, variant, qty, unit price snapshot, cost snapshot (filled at completion),
  station, notes, status; `order_item_modifiers` — option, price delta, inventory effect snapshot.
- `order_discounts` — type, value, computed amount, reason, authorizer, SC/PWD id ref.
- `payments` — method (configurable `payment_methods` table), amount, reference no, tendered,
  change, cashier, shift, status (`posted`,`voided`,`refunded`), idempotency key.
- `tabs` — name, customer, status, opened/closed by, running totals (cached from orders).
- `refunds` — order, items jsonb, amounts, reason, authorizer, method; reversal movements linked.

### KDS (Phase 4)
- `kds_tickets`, `kds_ticket_items` — station, statuses (`new`→`served`/`cancelled`), timestamps
  per transition, priority. Created only for prepared items.

### Purchasing (Phase 5)
- `suppliers`, `purchase_orders`, `purchase_order_items` (status per plan),
- `goods_receipts`, `goods_receipt_items` — received/rejected qty, actual cost, landed cost allocation,
- `supplier_payments`; payable status derived per PO (paid/partial/unpaid/overdue by terms).

### Operations (Phase 6)
- `shifts` — open/close cash, expected cash (computed), variance + reason, per-method totals snapshot.
- `cash_movements` — paid-in/paid-out/drop with reason (feeds expected cash).
- `waste_records` — item or product, qty, reason (configurable `waste_reasons`), photo, approval state.
- `stock_counts`, `stock_count_items` — draft → submitted → approved → posted.
- `production_batches`, `production_inputs` — consumes ingredients, yields prepared inventory item batch.

### Money & customers (Phases 7–8)
- `expenses`, `expense_categories` — with approval status, attachment, recurring flag.
- `customers` — profile, contact, birthday, QR code token.
- `loyalty_accounts`, `loyalty_transactions` — earn/redeem/adjust/reverse ledger; rules in settings.

### Court (Phase 9)
- `court_sessions` — status (`available`,`reserved`,`in_use`,`cleaning`,`maintenance`), group name,
  start/expected end, linked tab, notes. History = closed sessions.

### Storage
- `attachments` — generic file metadata (expense receipts, waste photos) in Supabase Storage,
  bucket-scoped RLS, size/mime restrictions.

## Key functions (all SECURITY DEFINER, permission-checked, audited)

Listed in ARCHITECTURE.md §Atomic workflows. Shared helpers:
- `has_permission(text)` / `current_role()` — RLS + RPC gate.
- `next_doc_number(kind)` — sequential numbers with advisory lock.
- `convert_qty(item, qty, from_unit)` — validated unit conversion.
- `consume_stock(item, qty, movement_type, ref, allow_negative)` — FEFO batch consumption returning
  actual cost consumed; respects negative-stock policy setting and expired-batch exclusion.
- `add_stock(item, qty, unit_cost, batch fields, movement_type, ref)` — batch + WAC update.
- `log_audit(action, entity, id, before, after, reason)`.

## Verification

`scripts/db.sh reset` rebuilds the local DB: creates a stub `auth` schema (`auth.users`,
`auth.uid()`), applies every migration in order, loads `supabase/seed.sql`.
`npm run test:db` runs the SQL business-logic test suite in `tests/db/` against it
(each test file runs in a rolled-back transaction where possible; destructive suites re-reset).
The same migrations apply unchanged to the real Supabase project (which provides the real
`auth` schema).
