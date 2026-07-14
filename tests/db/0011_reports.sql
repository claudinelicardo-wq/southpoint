-- Phase 7 tests: reporting functions reconcile with posted records. Rolls back.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000f1', 'owner-r@test', '{"full_name":"Owner Rita","role":"owner"}'),
  ('00000000-0000-0000-0000-0000000000f2', 'cash-r@test', '{"full_name":"Cash Ramon","role":"cashier"}');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', true); -- owner

-- Two retail sales today: water 25×4 = 100, chips 55×2 = 110  (total 210).
select public.shift_open(500);
do $$
begin
  perform public.pos_checkout(jsonb_build_object(
    'order_type', 'takeaway',
    'items', jsonb_build_array(jsonb_build_object(
      'product_id', 'a0000000-0000-0000-0000-000000002007', 'qty', 4)),  -- water
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 100))
  ), gen_random_uuid());
  perform public.pos_checkout(jsonb_build_object(
    'order_type', 'dine_in',
    'items', jsonb_build_array(jsonb_build_object(
      'product_id', 'a0000000-0000-0000-0000-000000002009', 'qty', 2)),  -- chips
    'payments', jsonb_build_array(jsonb_build_object('method', 'gcash', 'amount', 110,
      'reference_no', 'GC-TEST-1'))
  ), gen_random_uuid());
end $$;

-- --- sales summary reconciles with a direct sum -----------------------------
do $$
declare
  s jsonb;
  v_direct_total numeric;
  v_from timestamptz := now() - interval '1 hour';
  v_to   timestamptz := now() + interval '1 hour';
begin
  s := public.report_sales_summary(v_from, v_to);

  select coalesce(sum(total), 0) into v_direct_total
    from public.orders
   where status = 'completed' and completed_at >= v_from and completed_at < v_to;

  if (s ->> 'order_count')::int <> 2 then
    raise exception 'summary order_count expected 2, got %', s ->> 'order_count';
  end if;
  if (s ->> 'gross_sales')::numeric <> 210 then
    raise exception 'summary gross_sales expected 210, got %', s ->> 'gross_sales';
  end if;
  if (s ->> 'total_collected')::numeric <> v_direct_total then
    raise exception 'summary total % != direct sum %', s ->> 'total_collected', v_direct_total;
  end if;
  if (s ->> 'net_sales')::numeric <> 210 then
    raise exception 'summary net_sales expected 210, got %', s ->> 'net_sales';
  end if;
  -- gross_profit must equal net_sales - cogs
  if (s ->> 'gross_profit')::numeric <> 210 - (s ->> 'cogs')::numeric then
    raise exception 'gross_profit does not reconcile with cogs';
  end if;
  if (s ->> 'avg_order_value')::numeric <> 105 then
    raise exception 'aov expected 105, got %', s ->> 'avg_order_value';
  end if;
end $$;

-- --- breakdown by product -------------------------------------------------
do $$
declare v_water numeric; v_chips numeric; v_rows int;
begin
  select count(*) into v_rows
    from public.report_sales_breakdown('product', now() - interval '1 hour', now() + interval '1 hour');
  if v_rows <> 2 then raise exception 'product breakdown expected 2 rows, got %', v_rows; end if;

  select amount into v_water
    from public.report_sales_breakdown('product', now() - interval '1 hour', now() + interval '1 hour')
   where label ilike '%water%';
  select amount into v_chips
    from public.report_sales_breakdown('product', now() - interval '1 hour', now() + interval '1 hour')
   where label ilike '%chip%';
  if v_water <> 100 then raise exception 'water amount expected 100, got %', v_water; end if;
  if v_chips <> 110 then raise exception 'chips amount expected 110, got %', v_chips; end if;
end $$;

-- --- breakdown by payment method: cash 100, gcash 110 ---------------------
do $$
declare v_cash numeric; v_gcash numeric;
begin
  select amount into v_cash
    from public.report_sales_breakdown('payment_method', now() - interval '1 hour', now() + interval '1 hour')
   where label ilike 'cash';
  select amount into v_gcash
    from public.report_sales_breakdown('payment_method', now() - interval '1 hour', now() + interval '1 hour')
   where label ilike 'gcash';
  if v_cash <> 100 then raise exception 'cash total expected 100, got %', v_cash; end if;
  if v_gcash <> 110 then raise exception 'gcash total expected 110, got %', v_gcash; end if;
end $$;

-- --- P&L (owner has reports.profit) ---------------------------------------
do $$
declare p jsonb;
begin
  p := public.report_pnl(now() - interval '1 hour', now() + interval '1 hour');
  if (p ->> 'net_sales')::numeric <> 210 then
    raise exception 'pnl net_sales expected 210, got %', p ->> 'net_sales';
  end if;
  -- estimated_net_profit = gross_profit - waste - expenses
  if (p ->> 'estimated_net_profit')::numeric
     <> (p ->> 'gross_profit')::numeric - (p ->> 'waste_cost')::numeric - (p ->> 'operating_expenses')::numeric then
    raise exception 'estimated_net_profit does not reconcile';
  end if;
end $$;

-- --- inventory valuation returns rows and non-negative values -------------
do $$
declare v_rows int; v_neg int;
begin
  select count(*) into v_rows from public.report_inventory_valuation();
  if v_rows = 0 then raise exception 'valuation returned no rows'; end if;
  select count(*) into v_neg from public.report_inventory_valuation() where value < 0;
  if v_neg > 0 then raise exception 'valuation has negative values'; end if;
end $$;

-- --- permission gate: cashier cannot run profit report --------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f2', true); -- cashier
do $$
begin
  perform public.report_pnl(now() - interval '1 hour', now() + interval '1 hour');
  raise exception 'cashier P&L must be denied';
exception when others then
  if sqlerrm like '%must be denied%' then raise; end if;
  if sqlerrm not like '%permission denied%' then
    raise exception 'unexpected error for cashier pnl: %', sqlerrm;
  end if;
end $$;

rollback;
