-- Phase 5 tests: PO lifecycle, partial receiving, purchase-unit conversion,
-- WAC update, landed cost, payables. Rolls back.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000031', 'buyer@test', '{"full_name":"Ivy Inventory","role":"inventory"}'),
  ('00000000-0000-0000-0000-000000000032', 'kds2@test', '{"full_name":"Kim","role":"kitchen"}');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000031', true);

-- supplier + draft PO
insert into public.suppliers (id, name, payment_terms_days)
values ('00000000-0000-0000-0000-0000000000a1', 'Metro Beans Co.', 15);

do $$
declare v_po uuid;
begin
  v_po := public.po_create('00000000-0000-0000-0000-0000000000a1', current_date + 3, 'weekly order');
  if (select count(*) from public.purchase_orders where id = v_po and status = 'draft') <> 1 then
    raise exception 'draft PO not created';
  end if;
  -- order 4 x 1kg bags of beans @ 950/bag and 10 cases of water @ 240/case
  insert into public.purchase_order_items (id, po_id, item_id, qty_ordered, unit_cost) values
    ('00000000-0000-0000-0000-0000000000b1', v_po, 'a0000000-0000-0000-0000-000000001001', 4, 950),
    ('00000000-0000-0000-0000-0000000000b2', v_po, 'a0000000-0000-0000-0000-000000001015', 10, 240);
  update public.purchase_orders set status = 'sent' where id = v_po;
end $$;

-- receiving on a kitchen role must fail
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000032', true);
do $$
declare v_po uuid;
begin
  select id into v_po from public.purchase_orders limit 1;
  perform public.po_receive(v_po, jsonb_build_array(jsonb_build_object(
    'po_item_id', '00000000-0000-0000-0000-0000000000b1', 'qty_received', 1)));
  raise exception 'kitchen receiving must fail';
exception when others then
  if sqlerrm like '%must fail%' then raise; end if;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000031', true);

-- partial receive: 2 bags beans (cost changed to 1000/bag), 100 landed cost;
-- 4 cases water, 1 rejected damaged
do $$
declare
  res jsonb;
  beans_stock_before numeric; beans_stock_after numeric;
  beans_avg_before numeric; beans_avg_after numeric;
  water_stock_before numeric; water_stock_after numeric;
begin
  select current_stock, avg_cost into beans_stock_before, beans_avg_before
    from public.inventory_items where sku = 'ING-BEANS';
  select current_stock into water_stock_before
    from public.inventory_items where sku = 'RTL-WATER';

  res := public.po_receive(
    (select id from public.purchase_orders limit 1),
    jsonb_build_array(
      jsonb_build_object('po_item_id', '00000000-0000-0000-0000-0000000000b1',
        'qty_received', 2, 'unit_cost', 1000,
        'expires_at', (current_date + 180)::text),
      jsonb_build_object('po_item_id', '00000000-0000-0000-0000-0000000000b2',
        'qty_received', 4, 'qty_rejected', 1, 'unit_cost', 240,
        'expires_at', (current_date + 365)::text)
    ),
    100, 'INV-9001', 'first delivery');

  if res ->> 'status' <> 'partially_received' then
    raise exception 'PO should be partially received, got %', res ->> 'status';
  end if;

  select current_stock, avg_cost into beans_stock_after, beans_avg_after
    from public.inventory_items where sku = 'ING-BEANS';
  select current_stock into water_stock_after
    from public.inventory_items where sku = 'RTL-WATER';

  -- 2 bags * 1000g
  if beans_stock_after - beans_stock_before <> 2000 then
    raise exception 'beans stock should rise 2000g, got %', beans_stock_after - beans_stock_before;
  end if;
  -- 4 cases * 24 bottles (rejected case never enters stock)
  if water_stock_after - water_stock_before <> 96 then
    raise exception 'water stock should rise 96, got %', water_stock_after - water_stock_before;
  end if;
  -- landed cost allocation: beans line value 2000, water 960; beans share
  -- 100*2000/2960=67.57; per-gram cost=(2000+67.57)/2000=1.033784
  -- WAC: seed 5000g @0.90 → (5000*0.90+2000*1.033784)/7000 ≈ 0.938224
  if abs(beans_avg_after - 0.938224) > 0.0005 then
    raise exception 'beans WAC expected ≈0.938224, got %', beans_avg_after;
  end if;
end $$;

-- over-receiving must fail
do $$
declare v_po uuid;
begin
  select id into v_po from public.purchase_orders limit 1;
  perform public.po_receive(v_po, jsonb_build_array(jsonb_build_object(
    'po_item_id', '00000000-0000-0000-0000-0000000000b1', 'qty_received', 5)));
  raise exception 'over-receiving must fail';
exception when others then
  if sqlerrm like '%must fail%' then raise; end if;
end $$;

-- receive the remainder: 2 bags + 5 cases → PO fully received
do $$
declare res jsonb;
begin
  res := public.po_receive(
    (select id from public.purchase_orders limit 1),
    jsonb_build_array(
      jsonb_build_object('po_item_id', '00000000-0000-0000-0000-0000000000b1',
        'qty_received', 2, 'unit_cost', 950),
      jsonb_build_object('po_item_id', '00000000-0000-0000-0000-0000000000b2',
        'qty_received', 5, 'unit_cost', 240)
    ));
  if res ->> 'status' <> 'received' then
    raise exception 'PO should be fully received, got %', res ->> 'status';
  end if;
end $$;

-- payables: billed = receipts value + landed; record a payment
do $$
declare v_po uuid; v_balance numeric; v_billed numeric;
begin
  select id into v_po from public.purchase_orders limit 1;
  select billed_amount, balance into v_billed, v_balance
    from public.v_po_payables where po_id = v_po;
  -- receipts: (2*1000 + 4*240) + 100 landed + (2*950 + 5*240) = 2960+100+3100 = 6160
  if v_billed <> 6160 then raise exception 'billed should be 6160, got %', v_billed; end if;
  if v_balance <> 6160 then raise exception 'balance should be 6160, got %', v_balance; end if;

  perform public.supplier_pay('00000000-0000-0000-0000-0000000000a1', 5000, 'bank', v_po, 'BT-100');
  select balance into v_balance from public.v_po_payables where po_id = v_po;
  if v_balance <> 1160 then raise exception 'balance should be 1160, got %', v_balance; end if;
end $$;

-- ledger reconciliation still holds
reset role;
do $$
declare n int;
begin
  select count(*) into n from public.verify_stock_reconciliation();
  if n <> 0 then raise exception '% items fail reconciliation after receiving', n; end if;
end $$;

rollback;
select 'purchasing ok' as result;
