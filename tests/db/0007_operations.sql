-- Phase 6 tests: shift reconciliation, cash movements, waste approval flow,
-- stock counts, production, refunds and voids. Rolls back.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000041', 'cash6@test', '{"full_name":"Cassie","role":"cashier"}'),
  ('00000000-0000-0000-0000-000000000042', 'mgr6@test', '{"full_name":"Manny","role":"manager"}'),
  ('00000000-0000-0000-0000-000000000043', 'kit6@test', '{"full_name":"Kim","role":"kitchen"}');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000041', true);
select public.shift_open(500);

-- cash sale 50 (2 waters), then paid_out 100, paid_in 20
do $$
declare res jsonb;
begin
  res := public.pos_checkout(jsonb_build_object(
    'order_type', 'takeaway',
    'items', jsonb_build_array(jsonb_build_object(
      'product_id', 'a0000000-0000-0000-0000-000000002007', 'qty', 2)),
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 50))
  ), gen_random_uuid());
end $$;
select public.cash_move('paid_out', 100, 'bought ice');
select public.cash_move('paid_in', 20, 'change fund top-up');

-- blind count: cashier cannot see expected cash while open
do $$
declare v_shift uuid;
begin
  select id into v_shift from public.shifts where status = 'open'
   and cashier_id = '00000000-0000-0000-0000-000000000041';
  begin
    perform public.shift_expected_cash(v_shift);
    raise exception 'expected cash must be hidden from cashier';
  exception when others then
    if sqlerrm like '%must be hidden%' then raise; end if;
  end;
end $$;

-- gcash sale 25 (should not affect cash drawer)
do $$
declare res jsonb;
begin
  res := public.pos_checkout(jsonb_build_object(
    'order_type', 'takeaway',
    'items', jsonb_build_array(jsonb_build_object(
      'product_id', 'a0000000-0000-0000-0000-000000002007', 'qty', 1)),
    'payments', jsonb_build_array(jsonb_build_object(
      'method', 'gcash', 'amount', 25, 'reference_no', 'GC-1'))
  ), gen_random_uuid());
end $$;

-- variance without reason must fail; with reason closes.
-- expected cash = 500 + 50 - 100 + 20 = 470
do $$
declare res jsonb;
begin
  begin
    res := public.shift_close(400);
    raise exception 'variance without reason must fail';
  exception when others then
    if sqlerrm like '%must fail%' then raise; end if;
  end;
  res := public.shift_close(460, 'short 10 — wrong change given');
  if (res ->> 'expected_cash')::numeric <> 470 then
    raise exception 'expected cash should be 470, got %', res ->> 'expected_cash';
  end if;
  if (res ->> 'variance')::numeric <> -10 then
    raise exception 'variance should be -10, got %', res ->> 'variance';
  end if;
  if (res -> 'totals' ->> 'gross_sales')::numeric <> 75 then
    raise exception 'gross sales should be 75, got %', res -> 'totals' ->> 'gross_sales';
  end if;
end $$;

-- --- waste: kitchen reports (pending, no deduction), manager approves ---------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000043', true);
do $$
declare res jsonb; v_stock numeric;
begin
  select current_stock into v_stock from public.inventory_items where sku = 'ING-MILK';
  res := public.waste_report(
    'a0000000-0000-0000-0000-000000001002', null, null, 500, 'spilled', 'dropped a carton');
  if res ->> 'status' <> 'pending' then
    raise exception 'kitchen waste should be pending, got %', res ->> 'status';
  end if;
  if (select current_stock from public.inventory_items where sku = 'ING-MILK') <> v_stock then
    raise exception 'pending waste must not deduct stock';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000042', true);
do $$
declare w uuid; v_before numeric; v_after numeric; v_cost numeric;
begin
  select current_stock into v_before from public.inventory_items where sku = 'ING-MILK';
  select id into w from public.waste_records where status = 'pending' limit 1;
  perform public.waste_resolve(w, true);
  select current_stock into v_after from public.inventory_items where sku = 'ING-MILK';
  if v_before - v_after <> 500 then
    raise exception 'approved waste should deduct 500ml, got %', v_before - v_after;
  end if;
  select cost into v_cost from public.waste_records where id = w;
  if v_cost is null or v_cost <= 0 then raise exception 'waste cost must be recorded'; end if;
end $$;

-- prepared-product waste deducts recipe (1 Spanish Latte hot: beans/milk/condensed)
do $$
declare res jsonb; v_before numeric; v_after numeric;
begin
  select current_stock into v_before from public.inventory_items where sku = 'ING-COND';
  res := public.waste_report(null,
    'a0000000-0000-0000-0000-000000002003', 'a0000000-0000-0000-0000-000000003005',
    1, 'wrong_preparation', 'remade');
  if res ->> 'status' <> 'approved' then
    raise exception 'manager waste should auto-approve';
  end if;
  select current_stock into v_after from public.inventory_items where sku = 'ING-COND';
  if v_before - v_after <> 20 then
    raise exception 'condensed milk should drop 20ml, got %', v_before - v_after;
  end if;
end $$;

-- --- stock count -----------------------------------------------------------------
do $$
declare
  v_count uuid;
  v_stock numeric;
  res jsonb;
begin
  v_count := public.count_start(
    array['a0000000-0000-0000-0000-000000001015']::uuid[], 'water spot check');
  select current_stock into v_stock from public.inventory_items where sku = 'RTL-WATER';

  -- submitting without actuals fails
  begin
    perform public.count_submit(v_count);
    raise exception 'submit without actuals must fail';
  exception when others then
    if sqlerrm like '%must fail%' then raise; end if;
  end;

  update public.stock_count_items set actual_qty = v_stock - 3, note = '3 missing'
  where count_id = v_count;
  perform public.count_submit(v_count);
  res := public.count_post(v_count, true, 'monthly count');
  if (res ->> 'posted')::int <> 1 then raise exception 'one variance line expected'; end if;
  if (select current_stock from public.inventory_items where sku = 'RTL-WATER')
     <> v_stock - 3 then
    raise exception 'stock should reflect the count';
  end if;
end $$;

-- --- production: cook rice ----------------------------------------------------------
do $$
declare res jsonb; v_before numeric; v_after numeric; v_cost numeric;
begin
  -- consume 1000g sugar (stand-in raw input) to produce 900g cooked rice batch
  select current_stock into v_before from public.inventory_items where sku = 'ING-RICE';
  res := public.production_post(
    'a0000000-0000-0000-0000-000000001008', 900,
    jsonb_build_array(jsonb_build_object(
      'item_id', 'a0000000-0000-0000-0000-000000001006', 'qty', 1000)),
    (current_date + 2)::date, 0, 'morning batch');
  select current_stock into v_after from public.inventory_items where sku = 'ING-RICE';
  if v_after - v_before <> 900 then
    raise exception 'production should add 900g, got %', v_after - v_before;
  end if;
  v_cost := (res ->> 'unit_cost')::numeric;
  -- 1000g sugar @0.065 → 65 / 900 ≈ 0.072222
  if abs(v_cost - 0.072222) > 0.0005 then
    raise exception 'batch unit cost expected ≈0.072222, got %', v_cost;
  end if;
end $$;

-- --- refund and void ------------------------------------------------------------------
select public.shift_open(1000);
do $$
declare
  res jsonb; v_order uuid; v_stock_before numeric; v_stock_after numeric;
begin
  select current_stock into v_stock_before from public.inventory_items where sku = 'RTL-CHIPS';
  res := public.pos_checkout(jsonb_build_object(
    'order_type', 'takeaway',
    'items', jsonb_build_array(jsonb_build_object(
      'product_id', 'a0000000-0000-0000-0000-000000002009', 'qty', 2)),  -- chips 55x2
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 110))
  ), gen_random_uuid());
  v_order := (res ->> 'order_id')::uuid;

  -- partial refund with restock
  res := public.order_refund(v_order, 55, 'cash', 'one bag returned unopened', true,
    gen_random_uuid());
  if res ->> 'refund_number' is null then raise exception 'refund not recorded'; end if;
  select current_stock into v_stock_after from public.inventory_items where sku = 'RTL-CHIPS';
  -- sold 2, restocked 2 (full order consumption reversed)
  if v_stock_after <> v_stock_before then
    raise exception 'restock should restore chips stock, before % after %', v_stock_before, v_stock_after;
  end if;
  if (select refund_total from public.orders where id = v_order) <> 55 then
    raise exception 'refund total not tracked';
  end if;

  -- voiding a refunded order is blocked
  begin
    perform public.order_void(v_order, 'trying to void');
    raise exception 'void after refund must fail';
  exception when others then
    if sqlerrm like '%must fail%' then raise; end if;
  end;
end $$;

-- clean void reverses payments and stock
do $$
declare
  res jsonb; v_order uuid; v_before numeric; v_after numeric;
begin
  select current_stock into v_before from public.inventory_items where sku = 'RTL-COLA';
  res := public.pos_checkout(jsonb_build_object(
    'order_type', 'takeaway',
    'items', jsonb_build_array(jsonb_build_object(
      'product_id', 'a0000000-0000-0000-0000-000000002008', 'qty', 1)),
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 45))
  ), gen_random_uuid());
  v_order := (res ->> 'order_id')::uuid;
  perform public.order_void(v_order, 'test transaction');
  select current_stock into v_after from public.inventory_items where sku = 'RTL-COLA';
  if v_before <> v_after then raise exception 'void must restore stock'; end if;
  if (select status from public.orders where id = v_order) <> 'voided' then
    raise exception 'order should be voided';
  end if;
  if exists (select 1 from public.payments where order_id = v_order and status = 'posted') then
    raise exception 'payments should be voided';
  end if;
end $$;

-- cashier cannot void
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000041', true);
do $$
declare v_order uuid;
begin
  select id into v_order from public.orders where status = 'completed' limit 1;
  begin
    perform public.order_void(v_order, 'nope');
    raise exception 'cashier void must fail';
  exception when others then
    if sqlerrm like '%must fail%' then raise; end if;
  end;
end $$;

-- ledger reconciliation
reset role;
do $$
declare n int;
begin
  select count(*) into n from public.verify_stock_reconciliation();
  if n <> 0 then raise exception '% items fail reconciliation after operations', n; end if;
end $$;

rollback;
select 'operations ok' as result;
