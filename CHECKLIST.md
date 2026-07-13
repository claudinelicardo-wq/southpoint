# South Point — Build Checklist

Progress tracker. A box is checked only when the feature works against the database and its
tests/manual QA pass — not merely when the page renders.

## Phase 1 — Foundation
- [ ] Next.js 16 scaffold, TS strict, Tailwind 4, git repo
- [ ] Supabase client/server/proxy wiring + env configuration (`.env.example`)
- [ ] Local Postgres verification harness (`scripts/db.sh`, stub auth schema)
- [ ] Migration 0001: profiles, role_permissions, settings, audit_logs, doc_counters, helpers, RLS
- [ ] Login page + protected routes + role-aware navigation shell
- [ ] Design system (tokens, buttons, inputs, cards, dialogs, tables, badges, alerts, empty states)
- [ ] Settings module (business profile, tax, receipt, policies) — owner-gated writes
- [ ] Staff management (invite/activate/deactivate, role assignment) — owner-gated
- [ ] Audit log viewer (owner)
- [ ] DB tests: permissions, audit immutability, settings gating

## Phase 2 — Catalog & inventory
- [ ] Migration: units, categories, products, variants, modifiers, inventory items/batches/movements, recipes
- [ ] Unit conversion function + validation tests
- [ ] Ledger functions: add_stock / consume_stock (FEFO, WAC, negative-stock policy, expired exclusion)
- [ ] Menu management UI (prepared items, variants, modifiers, photos)
- [ ] Retail products UI (barcode/SKU, linked inventory)
- [ ] Ingredients & recipe editor with live cost + margin display
- [ ] Opening stock entry; low-stock warnings
- [ ] DB tests: conversions, WAC math, FEFO, reconciliation

## Phase 3 — POS
- [ ] pos_post_order + pos_complete_sale RPCs (idempotent, server-priced)
- [ ] Tablet-first POS screen (categories, search, tiles, cart, modifiers, notes, discounts)
- [ ] Order types incl. courtside labels; hold/resume; clear
- [ ] Open tabs (create, add orders, partial settle, close, reopen w/ manager auth, transfer/merge)
- [ ] Split payment; payment methods from settings; reference numbers
- [ ] Receipt (58/80mm print CSS), reprint (audited), kitchen ticket print
- [ ] Inventory deduction (retail unit + recipe w/ modifier effects) verified by ledger
- [ ] Order history
- [ ] DB tests: mixed sale, modifier replacement deduction, tab no-double-deduct, split payment,
      duplicate-idempotency, discount math

## Phase 4 — KDS
- [ ] Ticket creation routed by station on sale completion
- [ ] KDS screen with realtime updates, elapsed time, item + ticket status flow
- [ ] Retail-only orders create no tickets

## Phase 5 — Purchasing
- [ ] Suppliers CRUD
- [ ] PO lifecycle (draft→sent→partial→received→closed/cancelled), print view
- [ ] Receiving (partial, cost changes, rejected qty, landed costs) → batches + ledger + WAC
- [ ] Supplier payments, balances, overdue view
- [ ] DB tests: partial receive, WAC update, payable status

## Phase 6 — Operational controls
- [ ] Shift open/close, blind count, variance reason, printable shift report
- [ ] Cash movements (paid in/out)
- [ ] Waste workflow with approval + recipe-ingredient deduction
- [ ] Stock counts (draft→approve→post variance)
- [ ] Production batches (consume ingredients → prepared item stock)
- [ ] Refunds & voids reversing payment/inventory/COGS/loyalty/shift
- [ ] DB tests: shift math, waste, count posting, refund/void reversal, production

## Phase 7 — Accounting & reports
- [ ] Report queries + date filters + CSV export + print styles
- [ ] Sales summary/by day/hour/product/category/cashier/type/method
- [ ] COGS, gross profit, expenses, estimated net profit (labeled estimated)
- [ ] Inventory valuation & movement, variance, waste reports
- [ ] Expenses module with approval + attachments
- [ ] Reconciliation checks (reports tie to source records)

## Phase 8 — Customers & loyalty
- [ ] Customer profiles, search, history, spend stats
- [ ] Loyalty ledger, configurable rules, redemption at POS, QR membership
- [ ] Reversal on refund/void (tested)

## Phase 9 — Court
- [ ] Court status widget (POS + dashboard), sessions with linked tab, history

## Phase 10 — Production readiness
- [ ] RLS / permission audit (automated matrix test)
- [ ] Calculation audit pass
- [ ] Concurrency tests (parallel stock deduction, duplicate payment)
- [ ] Responsive review (tablet POS, mobile management, desktop reports)
- [ ] PWA manifest + install; offline cart persistence
- [ ] Seed-data removal script
- [ ] docs/DEPLOYMENT.md (Supabase + Vercel + GitHub setup), backup/recovery, user guide

## External blockers (need owner action)
- [ ] Create GitHub repository (no `gh` CLI installed / not authenticated)
- [ ] Create Supabase cloud project (`supabase login` not done on this machine)
- [ ] Create Vercel project (no `vercel` CLI installed)
