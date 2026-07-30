# South Point — Deployment & Operations Guide

This guide takes South Point from the local codebase to a live deployment on
Supabase + Vercel, and covers first-owner setup, backups, and day-to-day use.

The app is **completely independent of BizManager**. Create brand-new accounts
and a brand-new Supabase project — never reuse BizManager's database, keys, or
records.

---

## 0. Prerequisites (one time)

Install and authenticate the CLIs on the machine you deploy from:

| Tool | Install | Auth |
|------|---------|------|
| GitHub CLI | `brew install gh` | `gh auth login` |
| Supabase CLI | already installed (`supabase --version`) | `supabase login` |
| Vercel CLI | `npm i -g vercel` | `vercel login` |

> On the current build machine none of these are authenticated yet, which is why
> the GitHub repo, Supabase project, and Vercel project have not been created
> automatically. The steps below are the exact commands to run once they are.

---

## 1. GitHub repository

```bash
cd south-point
gh repo create south-point --private --source=. --remote=origin --push
```

The working tree is already a git repo with a full commit history — this pushes
it to a new private repository.

---

## 2. Supabase project

1. Create a new project at <https://supabase.com/dashboard> (or
   `supabase projects create south-point`). Choose the Singapore region for the
   lowest latency to the Philippines. Save the database password.
2. Link the local repo and push the migrations:

   ```bash
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push          # applies supabase/migrations/*.sql in order
   ```

   The migrations are the single source of truth for the schema, RLS policies,
   and all business-logic functions. They apply unchanged to the cloud project.

3. **Seed data is optional and dev-only.** For a production install, start from
   an empty catalog. If you loaded `supabase/seed.sql` into a staging project and
   want it gone before go-live:

   ```bash
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/remove-seed.sql
   ```

   This removes only the seeded catalog rows (fixed `a0000000-` UUID prefix) and
   leaves base reference data (units, payment methods, expense categories, roles)
   intact. It refuses to run (rolls back) if real sales already reference the seed
   catalog.

---

## 3. Environment variables

Copy `.env.example` to `.env.local` for local runs, and set the same keys in the
Vercel project. Values come from **Supabase → Project Settings → API**.

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR-ANON-KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR-SERVICE-ROLE-KEY   # server-only, NEVER expose
```

- `SUPABASE_SERVICE_ROLE_KEY` is used only in server code (staff administration).
  It must **never** be prefixed with `NEXT_PUBLIC_` and must be set as a
  server-side (non-public) variable in Vercel.
- The anon key is safe for the browser; RLS is what protects the data.

---

## 4. Vercel deployment

```bash
vercel link            # create/link the project
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel --prod
```

Framework preset: **Next.js** (auto-detected). Build command `next build`, output
handled by Vercel automatically. Connect the GitHub repo in the Vercel dashboard
so every push to `main` deploys.

Finally, in **Supabase → Authentication → URL Configuration**, add the Vercel
production URL (and any preview URLs) to the allowed redirect list.

---

## 5. First owner (bootstrap)

New sign-ups default to the **cashier** role, and only an owner can promote staff
— so the very first owner must be promoted directly in the database once:

1. Create the account (Supabase → Authentication → Add user, or the app's login
   once email sign-up is enabled).
2. Promote it to owner:

   ```sql
   update public.profiles
      set role = 'owner', is_active = true
    where id = (select id from auth.users where email = 'owner@southpoint.example');
   ```

From then on, the owner manages all staff from **Settings → Staff** in the app.

---

## 6. Backup & recovery

- **Automated backups:** Supabase Pro projects include daily backups with
  point-in-time recovery. Enable PITR under **Database → Backups** for a café
  handling real money.
- **Manual snapshot before risky changes:**

  ```bash
  supabase db dump --file backups/southpoint-$(date +%F).sql
  ```

- **Restore:** create/reset a project and apply the dump, then re-run
  `supabase db push` if the schema advanced since the snapshot.
- Financial records are never hard-deleted by the app (voids/refunds are
  reversing entries), so the audit log and ledgers remain a reliable recovery
  reference.

---

## 7. Operations quick-start (staff)

| Role | Can do |
|------|--------|
| **Owner** | Everything, incl. financial reports, staff, settings, audit log |
| **Manager** | Operations, catalog, inventory, purchasing, expenses, shifts, most reports |
| **Cashier** | POS, active orders, own shifts, limited customer info, receipts |
| **Barista / Kitchen** | Kitchen/Bar display, prep status, report waste |
| **Inventory** | Receive deliveries, counts, adjustments, purchase orders |
| **Accountant** | Sales/payment reports, expenses, purchases, reconciliation, exports |

A normal service day:

1. **Cashier opens a shift** (Shifts → Open) with the starting cash float.
2. **Take orders** in POS — dine-in, takeaway, courtside, or an open tab. Café
   items and retail products can share one order.
3. **Kitchen/Bar screen** shows prep tickets in real time (retail-only orders
   make no ticket). Staff advance New → Preparing → Ready → Served.
4. **Payments** post against orders; tabs can be settled partially or in full,
   with split payment across cash / GCash / Maya / card / bank.
5. Completed sales deduct inventory automatically — retail by the unit, prepared
   items by recipe (with modifier substitutions), or from a prepared batch.
6. **Court widget** (Dashboard / POS) tracks the single pickleball court and its
   linked tab.
7. **Cashier closes the shift** with a blind cash count; variance needs a reason.
8. **Reports / Accounting** show the day's sales, COGS, and estimated profit
   straight from posted records; export CSV or print.

---

## 8. Verifying a healthy install

```bash
npm run build          # production build must pass
npx tsc --noEmit       # strict typecheck
npx eslint app components lib
scripts/db.sh test     # all DB logic suites (run against a local Postgres)
```

The database test suites exercise the money-critical logic: mixed sales, recipe
deduction, weighted-average cost, partial receiving, shift reconciliation,
refunds/voids, loyalty reversal, report reconciliation, and duplicate-payment
idempotency. The suite also runs `tests/db/concurrency.sh`, a two-connection race
test proving `consume_stock`'s row lock stops two terminals from overselling the
same stock. All must pass before shipping a change that touches business logic.

`scripts/db.sh test` runs against a local Postgres and validates the schema and
functions. It does not exercise the app's own Supabase queries — the go-live
smoke test below does that against the real database.

---

## 9. Go-live smoke test (first 15 minutes on the live app)

Static checks confirm the schema, RLS, and every query/RPC the app makes are
structurally correct. This walkthrough is the final proof: it drives the real
UI against the live Supabase project and touches every money-critical path once.
Run it immediately after deploying, before real customers.

**Setup (owner):**

- [ ] Sign in as the owner. The sidebar shows all sections (Operate, Manage,
      Money, Admin). The top bar reads **Online** (green).
- [ ] **Settings → Business profile**: set name, address, contact, receipt width.
- [ ] Create the minimum catalog to exercise both product types:
  - One **prepared item** (Menu) with a **recipe** of 2+ ingredients (Recipes),
    each ingredient given opening stock (Inventory → adjustment).
  - One **retail product** (Products) linked to an inventory item with stock.
  - One **modifier** group with an option that adds price and swaps an ingredient.

**Sell (cashier, or owner):**

- [ ] **Shifts → Open** with a starting float (e.g. ₱1,000). Selling is blocked
      until a shift is open.
- [ ] In **POS**, build one order with **both** the prepared drink (add the
      modifier) **and** the retail product. Subtotal and total update live.
- [ ] Take payment as a **split** (part cash, part GCash with a reference). The
      order will not close until payments cover the total.
- [ ] **Print/preview the receipt**; reprint it (the reprint is audited).

**Verify the sale posted correctly:**

- [ ] **Kitchen / Bar**: the prepared drink appears as a ticket; the retail item
      does **not**. Advance it New → Preparing → Ready → Served.
- [ ] **Inventory**: the recipe ingredients dropped by their recipe amounts (with
      the modifier's ingredient swap applied), and the retail item dropped by one.
      Each change shows in the item's movement ledger.
- [ ] **Reports** (Today): the sale, its payment split, and COGS appear. Numbers
      tie to what you charged.

**Purchasing → payables → accounting:**

- [ ] **Suppliers**: add one. **Purchasing**: create a PO, mark sent, **receive**
      it (full or partial). The received item's stock rises and its weighted-average
      cost updates. A payable appears for the supplier.
- [ ] **Expenses**: record one (e.g. utilities) and approve it. **Accounting**:
      it reduces estimated net profit; inventory value and payables show.

**Reversals and close:**

- [ ] **Void or refund** the earlier sale (Orders → the order). Confirm revenue,
      inventory, COGS, loyalty, and the shift totals all reverse.
- [ ] **Shifts → Close** with a blind cash count. Expected vs actual reconciles;
      a variance requires a reason. The shift report prints.

**Access control (create a second, cashier account):**

- [ ] Signed in as a **cashier**, the sidebar hides Accounting, Staff, Audit Logs,
      and full profit figures. Visiting `/accounting` directly redirects away.
      This confirms RLS and role gating hold on the live project, not just in tests.

If every box checks, the install is verified end-to-end and ready for service.
Anything that fails here points at data/config (missing catalog, env keys, or the
Supabase redirect URL), not app logic, which the test suites already cover.
