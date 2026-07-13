-- Phase 2 tests: unit conversion, WAC, FEFO, expiry, negative-stock policy,
-- column guard, reconciliation, permissions. Rolls back.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000011', 'inv@test', '{"full_name":"Ina Inventory","role":"inventory"}'),
  ('00000000-0000-0000-0000-000000000012', 'kds@test', '{"full_name":"Kim Kitchen","role":"kitchen"}');

-- --- unit conversion ---------------------------------------------------------
do $$ begin
  if public.convert_units(2, 'kg', 'g') <> 2000 then raise exception 'kg->g'; end if;
  if public.convert_units(1500, 'ml', 'l') <> 1.5 then raise exception 'ml->l'; end if;
  begin
    perform public.convert_units(1, 'kg', 'ml');
    raise exception 'mass->volume must fail';
  exception when others then
    if sqlerrm like '%must fail%' then raise; end if;
  end;
end $$;

-- --- WAC ----------------------------------------------------------------------
-- fresh test item to keep math exact
insert into public.inventory_items (id, name, inventory_type, base_unit)
values ('00000000-0000-0000-0000-0000000000f1', 'Test Beans', 'ingredient', 'g');

select public.add_stock('00000000-0000-0000-0000-0000000000f1', 1000, 1.00, 'opening_balance');
select public.add_stock('00000000-0000-0000-0000-0000000000f1', 1000, 2.00, 'purchase_receipt');

do $$
declare v public.inventory_items%rowtype;
begin
  select * into v from public.inventory_items where id = '00000000-0000-0000-0000-0000000000f1';
  if v.current_stock <> 2000 then raise exception 'stock should be 2000, got %', v.current_stock; end if;
  if v.avg_cost <> 1.5 then raise exception 'WAC should be 1.5, got %', v.avg_cost; end if;
  if v.latest_cost <> 2.0 then raise exception 'latest cost should be 2.0'; end if;
end $$;

-- --- FEFO with expiry ---------------------------------------------------------
insert into public.inventory_items (id, name, inventory_type, base_unit, track_expiry)
values ('00000000-0000-0000-0000-0000000000f2', 'Test Milk', 'ingredient', 'ml', true);

-- batch A expires in 2 days at cost 0.10; batch B in 30 days at 0.20; batch C expired at 0.05
select public.add_stock('00000000-0000-0000-0000-0000000000f2', 1000, 0.10, 'purchase_receipt', null, null, (current_date + 2)::date);
select public.add_stock('00000000-0000-0000-0000-0000000000f2', 1000, 0.20, 'purchase_receipt', null, null, (current_date + 30)::date);
select public.add_stock('00000000-0000-0000-0000-0000000000f2', 500, 0.05, 'purchase_receipt', null, null, (current_date - 1)::date);

do $$
declare v_cost numeric;
begin
  -- consumes 1200: 1000 from A (0.10) then 200 from B (0.20); expired C skipped
  v_cost := public.consume_stock('00000000-0000-0000-0000-0000000000f2', 1200, 'recipe_consumption');
  if v_cost <> 140 then raise exception 'FEFO cost should be 140, got %', v_cost; end if;
end $$;

do $$
declare v_remaining numeric;
begin
  select qty_remaining into v_remaining from public.inventory_batches
   where item_id = '00000000-0000-0000-0000-0000000000f2' and unit_cost = 0.05;
  if v_remaining <> 500 then raise exception 'expired batch must not be consumed'; end if;
end $$;

-- expired stock is not usable: only 800 non-expired remains (B), so 900 must fail
do $$ begin
  perform public.consume_stock('00000000-0000-0000-0000-0000000000f2', 900, 'recipe_consumption');
  raise exception 'consuming more than non-expired stock must fail';
exception when others then
  if sqlerrm like '%must fail%' then raise; end if;
end $$;

-- ... unless explicitly allowed (manager override). With the override, FEFO
-- consumes the expired batch first (earliest expiry): 500*0.05 + 400*0.20 = 105.
do $$
declare v_cost numeric;
begin
  v_cost := public.consume_stock('00000000-0000-0000-0000-0000000000f2', 900, 'waste',
    null, null, 'clearing stock', null, true, null);
  if v_cost <> 105 then raise exception 'override cost should be 105, got %', v_cost; end if;
end $$;

-- --- negative stock policy ------------------------------------------------------
do $$ begin
  perform public.consume_stock('00000000-0000-0000-0000-0000000000f2', 10000, 'sale');
  raise exception 'negative stock must be blocked by default';
exception when others then
  if sqlerrm like '%must be blocked%' then raise; end if;
end $$;

do $$
declare v_cost numeric; v_stock numeric;
begin
  v_cost := public.consume_stock('00000000-0000-0000-0000-0000000000f2', 500, 'sale',
    null, null, null, null, false, true); -- explicit allow_negative
  select current_stock into v_stock from public.inventory_items
   where id = '00000000-0000-0000-0000-0000000000f2';
  if v_stock <> -100 then raise exception 'stock should be -100, got %', v_stock; end if;
end $$;

-- --- guard trigger ---------------------------------------------------------------
do $$ begin
  update public.inventory_items set current_stock = 999999
   where id = '00000000-0000-0000-0000-0000000000f1';
  raise exception 'direct stock edit must be blocked';
exception when others then
  if sqlerrm like '%must be blocked%' then raise; end if;
end $$;

-- metadata edits still work
update public.inventory_items set reorder_level = 123
 where id = '00000000-0000-0000-0000-0000000000f1';

-- --- reconciliation ---------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from public.verify_stock_reconciliation();
  if n <> 0 then raise exception '% items fail reconciliation', n; end if;
end $$;

-- --- permissions -------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000012', true); -- kitchen
do $$ begin
  perform public.inventory_adjust('00000000-0000-0000-0000-0000000000f1', 10, 'test');
  raise exception 'kitchen must not adjust stock';
exception when others then
  if sqlerrm like '%must not adjust%' then raise; end if;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', true); -- inventory staff
select public.inventory_adjust('00000000-0000-0000-0000-0000000000f1', -50, 'damaged in storage');
do $$
declare v numeric;
begin
  select current_stock into v from public.inventory_items where id = '00000000-0000-0000-0000-0000000000f1';
  if v <> 1950 then raise exception 'adjusted stock should be 1950, got %', v; end if;
end $$;

-- reason is mandatory
do $$ begin
  perform public.inventory_adjust('00000000-0000-0000-0000-0000000000f1', -1, '  ');
  raise exception 'blank reason must be rejected';
exception when others then
  if sqlerrm like '%must be rejected%' then raise; end if;
end $$;

-- direct movement insert must be impossible for clients
do $$ begin
  insert into public.inventory_movements (item_id, movement_type, qty)
  values ('00000000-0000-0000-0000-0000000000f1', 'manual_adjust', 5);
  raise exception 'clients must not write the ledger directly';
exception when insufficient_privilege then null;
end $$;

-- --- costing view ------------------------------------------------------------------
reset role;
do $$
declare v_cost numeric;
begin
  -- Spanish Latte (Hot): 18g beans*1.02*0.90 + 180ml*0.095 + 20ml*0.145
  select estimated_cost into v_cost from public.v_product_cost
   where product_id = 'a0000000-0000-0000-0000-000000002003'
     and variant_id = 'a0000000-0000-0000-0000-000000003005';
  if v_cost is null or abs(v_cost - (round(18 * 1.02 * 0.90, 4) + 180 * 0.095 + 20 * 0.145)) > 0.01 then
    raise exception 'Spanish Latte hot cost unexpected: %', v_cost;
  end if;
end $$;

rollback;
select 'inventory ok' as result;
