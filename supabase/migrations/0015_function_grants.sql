-- 0015: close the function-execution gap.
--
-- 0001 meant to make functions deny-by-default, but its
-- `alter default privileges ... revoke execute on functions from public` does
-- not undo Supabase's own default privileges, which explicitly grant EXECUTE
-- on every new public function to `anon` and `authenticated`. So every
-- function created after 0001 was callable with only the public website key
-- (no login) — including internal helpers that have no permission check of
-- their own, e.g. loyalty_post (writes loyalty points) and add_stock /
-- consume_stock (write the inventory ledger).
--
-- Fix: (1) nothing is executable by anon; (2) internal helpers are executable
-- only by their SECURITY DEFINER callers (which run as the owner), not by
-- signed-in clients; (3) future functions start locked down too.
-- Safe to re-run.

-- 1. Logged-out callers get nothing.
revoke execute on all functions in schema public from public, anon;

-- 2. Internal helpers: called only from inside other SECURITY DEFINER
--    functions or server-side with the service-role key, never by the
--    browser. (service_role keeps its own grant.)
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'add_stock', 'consume_stock', 'loyalty_post', 'loyalty_redeem',
        'log_audit', 'order_restock', 'waste_post_internal',
        'verify_stock_reconciliation', 'handle_new_user', 'log_audit_service',
        'next_doc_number'
      )
  loop
    execute format('revoke execute on function %s from authenticated', f);
  end loop;
end $$;

-- 3. Future functions: no automatic EXECUTE for anon / authenticated.
alter default privileges in schema public revoke execute on functions from anon, authenticated;
