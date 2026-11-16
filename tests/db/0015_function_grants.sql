-- 0015: logged-out callers can execute nothing; signed-in clients cannot call
-- internal ledger helpers directly. Rolled back; changes nothing.
begin;

do $$
declare v_bad text;
begin
  select string_agg(p.proname, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');
  if v_bad is not null then
    raise exception 'FAIL anon can execute: %', v_bad;
  end if;

  select string_agg(p.proname, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('add_stock', 'consume_stock', 'loyalty_post', 'loyalty_redeem',
                      'log_audit', 'order_restock', 'waste_post_internal', 'next_doc_number')
    and has_function_privilege('authenticated', p.oid, 'execute');
  if v_bad is not null then
    raise exception 'FAIL authenticated can execute internal helpers: %', v_bad;
  end if;

  -- The app's own entry points must still work for signed-in staff.
  select string_agg(x, ', ') into v_bad
  from unnest(array['pos_checkout', 'tab_settle', 'inventory_adjust', 'has_permission',
                    'order_void', 'shift_open', 'loyalty_adjust', 'tab_reopen']) x
  where not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = x
      and has_function_privilege('authenticated', p.oid, 'execute'));
  if v_bad is not null then
    raise exception 'FAIL authenticated lost access to: %', v_bad;
  end if;

  -- Server-side (service-role) callers keep their helpers.
  if not has_function_privilege('service_role', 'public.next_doc_number(text)', 'execute') then
    raise exception 'FAIL service_role lost next_doc_number';
  end if;
end $$;

rollback;
