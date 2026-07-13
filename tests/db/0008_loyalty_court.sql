-- Phase 7-9 tests: expenses approval, loyalty earn/redeem/reversal, court
-- sessions. Rolls back.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000051', 'cash8@test', '{"full_name":"Cassie","role":"cashier"}'),
  ('00000000-0000-0000-0000-000000000052', 'mgr8@test', '{"full_name":"Manny","role":"manager"}'),
  ('00000000-0000-0000-0000-000000000053', 'acct8@test', '{"full_name":"Ana","role":"accountant"}');

-- enable loyalty with easy math: 1 point per ₱10, redeem ₱1/point, min ₱50
reset role;
update public.settings set value = jsonb_build_object(
  'enabled', true, 'points_per_peso', 0.1, 'min_purchase', 50,
  'redemption_value_per_point', 1, 'max_redemption_pct', 0.5,
  'points_expiry_days', 365, 'birthday_bonus_points', 50)
where key = 'loyalty';

insert into public.customers (id, full_name, mobile)
values ('00000000-0000-0000-0000-0000000000c1', 'Regular Rey', '0917');

-- --- expenses ---------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000053', true); -- accountant
do $$
declare v_exp uuid; v_cat uuid;
begin
  select id into v_cat from public.expense_categories where name = 'Utilities';
  v_exp := public.expense_create(current_date, v_cat, 'Meralco', 'July electricity', 4200);
  -- accountant has expenses.approve → auto-approved
  if (select status from public.expenses where id = v_exp) <> 'approved' then
    raise exception 'accountant expense should auto-approve';
  end if;
end $$;

-- cashier cannot create expenses
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000051', true);
do $$
declare v_cat uuid;
begin
  select id into v_cat from public.expense_categories limit 1;
  perform public.expense_create(current_date, v_cat, 'X', 'test', 100);
  raise exception 'cashier expense must fail';
exception when others then
  if sqlerrm like '%must fail%' then raise; end if;
end $$;

-- --- loyalty: earn on paid sale ------------------------------------------------
select public.shift_open(500);
do $$
declare res jsonb; v_balance numeric;
begin
  res := public.pos_checkout(jsonb_build_object(
    'order_type', 'takeaway',
    'customer_id', '00000000-0000-0000-0000-0000000000c1',
    'items', jsonb_build_array(jsonb_build_object(
      'product_id', 'a0000000-0000-0000-0000-000000002009', 'qty', 4)),  -- chips 55*4=220
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 220))
  ), gen_random_uuid());
  select points_balance into v_balance from public.loyalty_accounts
   where customer_id = '00000000-0000-0000-0000-0000000000c1';
  if v_balance <> 22 then raise exception 'should earn 22 points, got %', v_balance; end if;
end $$;

-- redeem: 20 points on an ₱80 order → capped at 50% (₱40)? 20 pts = ₱20 < 40 OK
do $$
declare res jsonb; v_balance numeric;
begin
  res := public.pos_checkout(jsonb_build_object(
    'order_type', 'takeaway',
    'customer_id', '00000000-0000-0000-0000-0000000000c1',
    'items', jsonb_build_array(jsonb_build_object(
      'product_id', 'a0000000-0000-0000-0000-000000002007', 'qty', 4)),  -- water 25*4=100
    'discounts', jsonb_build_array(jsonb_build_object('type', 'loyalty', 'value', 20)),
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 80))
  ), gen_random_uuid());
  if (res ->> 'total')::numeric <> 80 then
    raise exception 'loyalty total should be 80, got %', res ->> 'total';
  end if;
  select points_balance into v_balance from public.loyalty_accounts
   where customer_id = '00000000-0000-0000-0000-0000000000c1';
  -- 22 - 20 redeemed + 8 earned on the ₱80 paid = 10
  if v_balance <> 10 then raise exception 'balance should be 10, got %', v_balance; end if;
end $$;

-- redeeming more than balance fails and rolls back the order
do $$
begin
  perform public.pos_checkout(jsonb_build_object(
    'order_type', 'takeaway',
    'customer_id', '00000000-0000-0000-0000-0000000000c1',
    'items', jsonb_build_array(jsonb_build_object(
      'product_id', 'a0000000-0000-0000-0000-000000002007', 'qty', 1)),
    'discounts', jsonb_build_array(jsonb_build_object('type', 'loyalty', 'value', 999)),
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 25))
  ), gen_random_uuid());
  raise exception 'over-redemption must fail';
exception when others then
  if sqlerrm like '%must fail%' then raise; end if;
end $$;

-- void reverses earn (manager voids the first ₱220 sale: −22 points)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000052', true);
do $$
declare v_order uuid; v_balance numeric;
begin
  select id into v_order from public.orders
   where customer_id = '00000000-0000-0000-0000-0000000000c1' and total = 220;
  perform public.order_void(v_order, 'test void');
  select points_balance into v_balance from public.loyalty_accounts
   where customer_id = '00000000-0000-0000-0000-0000000000c1';
  if v_balance <> -12 then
    -- 10 - 22 = -12 (allowed: ledger keeps truth; account can go negative on reversal)
    raise exception 'post-void balance should be -12, got %', v_balance;
  end if;
end $$;

-- manual adjustment brings it back
do $$
declare v_balance numeric;
begin
  perform public.loyalty_adjust('00000000-0000-0000-0000-0000000000c1', 12, 'goodwill correction');
  select points_balance into v_balance from public.loyalty_accounts
   where customer_id = '00000000-0000-0000-0000-0000000000c1';
  if v_balance <> 0 then raise exception 'balance should be 0, got %', v_balance; end if;
end $$;

-- ledger sums to cached balance
do $$
declare v_ledger numeric; v_cached numeric;
begin
  select coalesce(sum(points), 0) into v_ledger from public.loyalty_transactions
   where customer_id = '00000000-0000-0000-0000-0000000000c1';
  select points_balance into v_cached from public.loyalty_accounts
   where customer_id = '00000000-0000-0000-0000-0000000000c1';
  if v_ledger <> v_cached then
    raise exception 'loyalty ledger (%) != cached balance (%)', v_ledger, v_cached;
  end if;
end $$;

-- --- court ---------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000051', true); -- cashier
do $$
declare v_id uuid;
begin
  v_id := public.court_set('in_use', '6:00 PM Players', null, null,
    now() + interval '2 hours', null, null);
  if (select count(*) from public.court_sessions where ended_at is null) <> 1 then
    raise exception 'one active court session expected';
  end if;
  -- switching status ends the previous session
  perform public.court_set('cleaning');
  if (select count(*) from public.court_sessions where ended_at is null) <> 1 then
    raise exception 'still one active session after switch';
  end if;
  if (select status from public.court_sessions where ended_at is null) <> 'cleaning' then
    raise exception 'active session should be cleaning';
  end if;
  perform public.court_set('available');
  if (select count(*) from public.court_sessions where ended_at is null) <> 0 then
    raise exception 'available should end all sessions';
  end if;
  if (select count(*) from public.court_sessions) < 2 then
    raise exception 'history should keep ended sessions';
  end if;
end $$;

rollback;
select 'loyalty/court ok' as result;
