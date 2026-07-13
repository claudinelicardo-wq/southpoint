# South Point Cafe & Lounge — Architecture

A completely standalone system. No connection to BizManager, Hormiga Cart, Claufee, or LaundryLens
databases or credentials. Patterns were *reviewed* from those projects (Supabase SSR client split,
role-gated admin navigation, ledger-style inventory) but all code and data here are new.

## Stack

| Layer      | Choice                                        | Notes |
|------------|-----------------------------------------------|-------|
| Framework  | Next.js 16 (App Router, Turbopack, `proxy.ts`) | TypeScript strict |
| Styling    | Tailwind CSS 4                                | Custom design tokens, no component library |
| Database   | Supabase PostgreSQL                           | All business rules live in SQL |
| Auth       | Supabase Auth (email + password)              | Staff accounts created by owner/manager |
| Realtime   | Supabase Realtime                             | KDS tickets, court status |
| Hosting    | Vercel (app) + Supabase (db/auth/storage)     | See docs/DEPLOYMENT.md |
| Local dev  | PostgreSQL 17 on port 54322                   | Docker is unavailable on this machine, so the full `supabase start` stack can't run locally; migrations + business logic are verified against real Postgres with a stubbed `auth` schema (`scripts/db.sh`) |

## Core principles

1. **The database is the source of truth.** Every financially sensitive operation (sale posting,
   payment, refund, void, receiving, stock adjustment, shift close, loyalty posting) is a
   `SECURITY DEFINER` Postgres function that runs in a single transaction, re-validates permissions,
   recalculates totals server-side, and writes audit rows. The browser never posts totals it
   computed itself.
2. **Ledgers, not mutable balances.** Inventory quantity, tab balances, loyalty points, and cash
   drawer amounts are all derived from append-only ledgers. Cached balance columns exist for speed
   but are maintained only inside the same transaction as the ledger row, and reconciliation
   queries verify cache == ledger.
3. **Snapshots for history.** Order items snapshot unit price, cost, tax config, and recipe cost at
   posting time. Changing a recipe or tax setting later never rewrites historical numbers.
4. **Idempotency.** Sale completion, payment posting, refunds, and voids accept a client-generated
   `idempotency_key` (unique constraint). A retry after a network failure returns the original
   result instead of double-posting.
5. **RLS everywhere.** Every table has row-level security. Read policies map to role permissions;
   writes to financial tables are denied to clients entirely — they only happen through RPCs.
6. **Soft archive, never delete.** Financial records are never hard-deleted. Catalog entities
   archive (`archived_at`). Audit logs accept inserts only (no UPDATE/DELETE grants, plus a
   BEFORE trigger that raises on update/delete).

## Module map

| Area | Route | Primary roles |
|------|-------|---------------|
| Dashboard | `/dashboard` | owner, manager (reduced view: others) |
| POS | `/pos` | cashier, manager, owner |
| Active Orders | `/orders` | cashier, manager, owner |
| Kitchen/Bar Display | `/kds` | kitchen, cashier, manager, owner |
| Menu | `/menu` | manager, owner |
| Products | `/products` | manager, owner, inventory |
| Inventory | `/inventory` | inventory, manager, owner |
| Recipes | `/recipes` | manager, owner |
| Purchasing | `/purchasing` | inventory, manager, owner |
| Suppliers | `/suppliers` | inventory, manager, owner |
| Expenses | `/expenses` | accountant, manager, owner |
| Accounting | `/accounting` | accountant, owner |
| Customers | `/customers` | cashier (limited), manager, owner |
| Loyalty | `/loyalty` | manager, owner |
| Shifts | `/shifts` | cashier (own), manager, owner |
| Reports | `/reports` | accountant, manager, owner |
| Staff | `/staff` | owner |
| Audit Logs | `/audit-logs` | owner |
| Settings | `/settings` | owner (subset: manager) |

Roles: `owner`, `manager`, `cashier`, `kitchen`, `inventory`, `accountant`.
Permissions are fine-grained keys (e.g. `pos.sell`, `inventory.adjust`, `reports.profit`) mapped
to roles in the `role_permissions` table so the owner can tune access without code changes.
`public.has_permission(perm text)` is the single gate used by RLS policies and RPCs.

## Atomic workflows (single-transaction RPCs)

| RPC | What it does atomically |
|-----|-------------------------|
| `pos_post_order` | Validates cart server-side (prices, modifiers, discounts, tax from settings snapshot), creates order + items + modifier rows, computes totals |
| `pos_complete_sale` | Posts payment(s), verifies payment total == order total, deducts inventory (retail units + recipe ingredients with FEFO batches), writes COGS snapshot, creates KDS tickets, awards loyalty, updates shift totals |
| `tab_add_order` / `tab_settle` | Adds an order to an open tab (inventory deducts once, when the order posts); settles partially/fully |
| `po_receive` | Creates goods receipt, inventory batches, ledger movements, recalculates weighted-average cost, updates PO status and payable |
| `stock_count_post` | Posts approved variance adjustments to the ledger |
| `waste_post` | Deducts item or recipe ingredients, records cost |
| `production_post` | Consumes ingredients, creates prepared-item batch with computed cost |
| `order_void` / `order_refund` | Reverses payments, inventory, COGS, loyalty, shift totals with reason + authorization |
| `shift_open` / `shift_close` | Opens/closes drawer, computes expected cash from ledger, records variance |
| `loyalty_adjust` | Manual point adjustment with authorization |

## Realtime

`kds_tickets` and `kds_ticket_items` publish INSERT/UPDATE to the KDS screen; `court_sessions`
publishes to the dashboard/POS court widget. Everything else is request/response.

## Offline behavior

The POS shows online/offline state (navigator + Supabase heartbeat). The active cart persists to
`localStorage` and survives refresh. Completing a sale requires the server round-trip; failed
writes are retried with the same idempotency key. No offline financial posting.

## Money & quantity precision

- Currency: `numeric(12,2)`, PHP, formatted with `Intl.NumberFormat("en-PH", { currency: "PHP" })`.
- Quantities: `numeric(14,4)` (supports 0.5 kg, 18 g portions, 0.25 serving).
- Costs per base unit: `numeric(14,6)` to avoid drift in weighted averages.
- All arithmetic that matters happens in Postgres `numeric`, never in JS floats.

## Timezone

All timestamps `timestamptz`. Business day boundaries computed in `Asia/Manila`
(`settings.timezone`), used by shift reports and daily sales grouping.
