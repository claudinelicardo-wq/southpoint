-- Phase 3 tests: checkout math, inventory deduction (retail + recipe +
-- modifier replacement), tabs (no double deduction, partial settle),
-- split payment, idempotency, discount rules, shift gating. Rolls back.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000021', 'cashier@pos', '{"full_name":"Cassie","role":"cashier"}'),
  ('00000000-0000-0000-0000-000000000022', 'mgr@pos', '{"full_name":"Manny","role":"manager"}');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000021', true);

-- --- shift gating: selling without a shift fails ---------------------------
do $$ begin
  perform public.pos_checkout(jsonb_build_object(
    'order_type', 'takeaway',
    'items', jsonb_build_array(jsonb_build_object(
      'product_id', 'a0000000-0000-0000-0000-000000002007', 'qty', 1)),
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 25))
  ), gen_random_uuid());
  raise exception 'selling without an open shift must fail';
exception when others then
  if sqlerrm like '%must fail%' then raise; end if;
end $$;

select public.shift_open(1000, 'Main');

-- --- mixed sale: Spanish Latte (Iced, Oat Milk, Extra Shot) + bottled water --
do $$
declare
  res jsonb;
  v_total numeric;
  v_key uuid := gen_random_uuid();
  beans_before numeric; beans_after numeric;
  milk_before numeric; milk_after numeric;
  oat_before numeric; oat_after numeric;
  water_before numeric; water_after numeric;
  cups_before numeric; cups_after numeric;
begin
  select current_stock into beans_before from public.inventory_items where sku = 'ING-BEANS';
  select current_stock into milk_before  from public.inventory_items where sku = 'ING-MILK';
  select current_stock into oat_before   from public.inventory_items where sku = 'ING-OAT';
  select current_stock into water_before from public.inventory_items where sku = 'RTL-WATER';
  select current_stock into cups_before  from public.inventory_items where sku = 'PKG-CUP12';

  res := public.pos_checkout(jsonb_build_object(
    'order_type', 'dine_in',
    'items', jsonb_build_array(
      jsonb_build_object(
        'product_id', 'a0000000-0000-0000-0000-000000002003',  -- Spanish Latte 150
        'variant_id', 'a0000000-0000-0000-0000-000000003006',  -- Iced +10
        'qty', 1,
        'modifier_option_ids', jsonb_build_array(
          'a0000000-0000-0000-0000-000000005001',  -- Oat Milk +30 (replace milk 180)
          'a0000000-0000-0000-0000-000000005002')  -- Extra Shot +40 (add beans 9)
      ),
      jsonb_build_object(
        'product_id', 'a0000000-0000-0000-0000-000000002007', 'qty', 2)  -- Water 25x2
    ),
    'payments', jsonb_build_array(
      jsonb_build_object('method', 'cash', 'amount', 280, 'tendered', 500))
  ), v_key);

  -- total: (150+10+30+40) + 2*25 = 280
  v_total := (res ->> 'total')::numeric;
  if v_total <> 280 then raise exception 'total should be 280, got %', v_total; end if;

  -- idempotent replay returns the same order, posts nothing new
  res := public.pos_checkout(jsonb_build_object(
    'order_type', 'dine_in',
    'items', jsonb_build_array(jsonb_build_object(
      'product_id', 'a0000000-0000-0000-0000-000000002007', 'qty', 99)),
    'payments', '[]'::jsonb
  ), v_key);
  if not (res ->> 'replayed')::boolean then raise exception 'replay not detected'; end if;

  select current_stock into beans_after from public.inventory_items where sku = 'ING-BEANS';
  select current_stock into milk_after  from public.inventory_items where sku = 'ING-MILK';
  select current_stock into oat_after   from public.inventory_items where sku = 'ING-OAT';
  select current_stock into water_after from public.inventory_items where sku = 'RTL-WATER';
  select current_stock into cups_after  from public.inventory_items where sku = 'PKG-CUP12';

  -- beans: base 18g * 1.02 waste = 18.36 + extra shot 9 = 27.36
  if beans_before - beans_after <> 27.36 then
    raise exception 'beans deduction should be 27.36, got %', beans_before - beans_after;
  end if;
  -- fresh milk fully replaced by oat: 0 deducted
  if milk_before - milk_after <> 0 then
    raise exception 'fresh milk must not be deducted (replaced), got %', milk_before - milk_after;
  end if;
  if oat_before - oat_after <> 180 then
    raise exception 'oat milk deduction should be 180, got %', oat_before - oat_after;
  end if;
  -- retail: 2 bottles
  if water_before - water_after <> 2 then
    raise exception 'water deduction should be 2, got %', water_before - water_after;
  end if;
  -- iced variant packaging: 1 cup
  if cups_before - cups_after <> 1 then
    raise exception 'cup deduction should be 1, got %', cups_before - cups_after;
  end if;
end $$;

-- COGS recorded and > 0
do $$
declare v numeric;
begin
  select cogs_total into v from public.orders order by created_at desc limit 1;
  if v is null or v <= 0 then raise exception 'COGS must be recorded, got %', v; end if;
end $$;

-- --- payment must match total -------------------------------------------------
do $$ begin
  perform public.pos_checkout(jsonb_build_object(
    'order_type', 'takeaway',
    'items', jsonb_build_array(jsonb_build_object(
      'product_id', 'a0000000-0000-0000-0000-000000002007', 'qty', 1)),
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 10))
  ), gen_random_uuid());
  raise exception 'underpayment must fail';
exception when others then
  if sqlerrm like '%must fail%' then raise; end if;
end $$;

-- --- e-wallet requires reference -----------------------------------------------
do $$ begin
  perform public.pos_checkout(jsonb_build_object(
    'order_type', 'takeaway',
    'items', jsonb_build_array(jsonb_build_object(
      'product_id', 'a0000000-0000-0000-0000-000000002007', 'qty', 1)),
    'payments', jsonb_build_array(jsonb_build_object('method', 'gcash', 'amount', 25))
  ), gen_random_uuid());
  raise exception 'gcash without reference must fail';
exception when others then
  if sqlerrm like '%must fail%' then raise; end if;
end $$;

-- --- discounts: cashier cannot give manual discount ------------------------------
do $$ begin
  perform public.pos_checkout(jsonb_build_object(
    'order_type', 'takeaway',
    'items', jsonb_build_array(jsonb_build_object(
      'product_id', 'a0000000-0000-0000-0000-000000002007', 'qty', 1)),
    'discounts', jsonb_build_array(jsonb_build_object('type', 'manual', 'value', 0.5)),
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 12.50))
  ), gen_random_uuid());
  raise exception 'cashier manual discount must fail';
exception when others then
  if sqlerrm like '%must fail%' then raise; end if;
end $$;

-- senior discount with ID: 20% off
do $$
declare res jsonb;
begin
  res := public.pos_checkout(jsonb_build_object(
    'order_type', 'takeaway',
    'items', jsonb_build_array(jsonb_build_object(
      'product_id', 'a0000000-0000-0000-0000-000000002007', 'qty', 4)),  -- 100
    'discounts', jsonb_build_array(jsonb_build_object(
      'type', 'senior', 'id_reference', 'SC-12345')),
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 80))
  ), gen_random_uuid());
  if (res ->> 'total')::numeric <> 80 then
    raise exception 'senior total should be 80, got %', res ->> 'total';
  end if;
end $$;

-- --- tabs: orders deduct once; settle partially then close ------------------------
do $$
declare
  res jsonb;
  v_tab uuid;
  water_before numeric; water_after numeric;
  v_outstanding numeric;
begin
  select current_stock into water_before from public.inventory_items where sku = 'RTL-WATER';

  -- round 1: 2 waters (50) on a new named tab
  res := public.pos_checkout(jsonb_build_object(
    'order_type', 'tab',
    'tab_name', 'Saturday Doubles',
    'items', jsonb_build_array(jsonb_build_object(
      'product_id', 'a0000000-0000-0000-0000-000000002007', 'qty', 2))
  ), gen_random_uuid());
  select tab_id into v_tab from public.orders where id = (res ->> 'order_id')::uuid;

  -- round 2: 1 cola (45) on the same tab
  res := public.pos_checkout(jsonb_build_object(
    'order_type', 'tab',
    'tab_id', v_tab,
    'items', jsonb_build_array(jsonb_build_object(
      'product_id', 'a0000000-0000-0000-0000-000000002008', 'qty', 1))
  ), gen_random_uuid());

  select current_stock into water_after from public.inventory_items where sku = 'RTL-WATER';
  if water_before - water_after <> 2 then
    raise exception 'tab water deduction should be exactly 2 (no double deduction), got %',
      water_before - water_after;
  end if;

  -- partial settle: 50 of 95
  res := public.tab_settle(v_tab,
    jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 50)),
    gen_random_uuid(), false);
  if (res ->> 'outstanding')::numeric <> 45 then
    raise exception 'outstanding should be 45, got %', res ->> 'outstanding';
  end if;

  -- closing with balance must fail
  begin
    perform public.tab_settle(v_tab,
      jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 10)),
      gen_random_uuid(), true);
    raise exception 'closing with balance must fail';
  exception when others then
    if sqlerrm like '%must fail%' then raise; end if;
  end;

  -- split payment settle: 20 cash + 25 gcash, close
  res := public.tab_settle(v_tab,
    jsonb_build_array(
      jsonb_build_object('method', 'cash', 'amount', 20),
      jsonb_build_object('method', 'gcash', 'amount', 25, 'reference_no', 'GC-777')),
    gen_random_uuid(), true);
  if not (res ->> 'closed')::boolean then raise exception 'tab should be closed'; end if;

  select coalesce(sum(total - amount_paid), 0) into v_outstanding
  from public.orders where tab_id = v_tab and status = 'completed';
  if v_outstanding <> 0 then raise exception 'tab orders not fully allocated'; end if;

  -- reopen: cashier lacks permission
  begin
    perform public.tab_reopen(v_tab, 'oops');
    raise exception 'cashier reopen must fail';
  exception when others then
    if sqlerrm like '%must fail%' then raise; end if;
  end;
end $$;

-- manager can reopen
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000022', true);
do $$
declare v_tab uuid;
begin
  select id into v_tab from public.tabs where name = 'Saturday Doubles';
  perform public.tab_reopen(v_tab, 'customer returned');
  if (select status from public.tabs where id = v_tab) <> 'open' then
    raise exception 'tab should be reopened';
  end if;
end $$;

-- --- held orders ------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000021', true);
do $$
declare res jsonb; water_before numeric; water_after numeric;
begin
  select current_stock into water_before from public.inventory_items where sku = 'RTL-WATER';
  res := public.pos_checkout(jsonb_build_object(
    'order_type', 'dine_in', 'hold', true,
    'items', jsonb_build_array(jsonb_build_object(
      'product_id', 'a0000000-0000-0000-0000-000000002007', 'qty', 5))
  ), gen_random_uuid());
  if not (res ->> 'held')::boolean then raise exception 'order should be held'; end if;
  select current_stock into water_after from public.inventory_items where sku = 'RTL-WATER';
  if water_before <> water_after then
    raise exception 'held orders must not deduct inventory';
  end if;
  perform public.order_cancel((res ->> 'order_id')::uuid, 'customer left');
  if (select status from public.orders where id = (res ->> 'order_id')::uuid) <> 'cancelled' then
    raise exception 'held order should be cancelled';
  end if;
end $$;

-- --- ledger still reconciles --------------------------------------------------------
reset role;
do $$
declare n int;
begin
  select count(*) into n from public.verify_stock_reconciliation();
  if n <> 0 then raise exception '% items fail reconciliation after sales', n; end if;
end $$;

rollback;
select 'pos ok' as result;
