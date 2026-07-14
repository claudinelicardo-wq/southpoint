-- Remove South Point development seed data.
--
-- The dev seed (supabase/seed.sql) only inserts catalog rows, all sharing the
-- fixed UUID prefix 'a0000000-'. This script deletes them in FK-safe order;
-- ON DELETE CASCADE handles variants, recipe ingredients, modifier options,
-- option effects, and product↔modifier links automatically.
--
-- Base reference data (units, payment methods, expense categories, roles and
-- permissions) is created by the migrations — NOT by the seed — so it is left
-- intact.
--
-- Safety: run this on a fresh dev/staging database BEFORE any real sales exist.
-- order_items → products is RESTRICT, so if real transactions reference the seed
-- catalog the whole script rolls back (nothing is half-deleted) and you'll see a
-- foreign-key error — archive or remove those transactions first.
--
-- Usage:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/remove-seed.sql
-- Idempotent: safe to run more than once.

begin;

delete from public.products        where id::text like 'a0000000-%';
delete from public.modifier_groups where id::text like 'a0000000-%';

-- Opening-stock ledger rows the seed created via add_stock() (movements
-- reference batches, both reference the item) — clear them before the item.
delete from public.inventory_movements where item_id::text like 'a0000000-%';
delete from public.inventory_batches   where item_id::text like 'a0000000-%';
delete from public.inventory_items     where id::text like 'a0000000-%';

delete from public.categories      where id::text like 'a0000000-%';

commit;
