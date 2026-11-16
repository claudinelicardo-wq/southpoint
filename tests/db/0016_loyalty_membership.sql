-- Loyalty stage 1: registration, duplicate prevention, hashed QR tokens and
-- revocation, points engine, idempotent awards, refunds, expiry, permissions.
-- Rolls back.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000161', 'cash16@test', '{"full_name":"Cara","role":"cashier"}'),
  ('00000000-0000-0000-0000-000000000162', 'mgr16@test', '{"full_name":"Mara","role":"manager"}'),
  ('00000000-0000-0000-0000-000000000163', 'kit16@test', '{"full_name":"Kiko","role":"kitchen"}');

-- Default rule after the migration: 1 point per ₱100.
do $$
declare cfg jsonb := public.get_setting('loyalty');
begin
  if (cfg ->> 'earn_points')::numeric <> 1 or (cfg ->> 'earn_per_amount')::numeric <> 100
     or cfg ? 'points_per_peso' then
    raise exception 'migration should set 1 point per 100, got %', cfg;
  end if;
end $$;
update public.settings set value = value || jsonb_build_object(
  'enabled', true, 'min_purchase', 0, 'points_expiry_days', 365) where key = 'loyalty';

create temp table t16 (k text primary key, v text) on commit drop;
grant all on t16 to authenticated;

-- --- registration -------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000161', true); -- cashier
do $$
declare res jsonb;
begin
  res := public.loyalty_member_register('Ana', 'Reyes', '+63 917 555 0101', 'ana@test', null, true);
  if res ->> 'member_no' !~ '^SPM\d{6}$' then raise exception 'bad member no %', res; end if;
  if res ->> 'qr_token' !~ '^SPQ[0-9A-F]{64}$' or res ->> 'portal_token' !~ '^SPP[0-9A-F]{64}$' then
    raise exception 'bad tokens %', res;
  end if;
  insert into t16 values ('cust', res ->> 'customer_id'), ('qr', res ->> 'qr_token'),
                         ('portal', res ->> 'portal_token');
end $$;

-- duplicate mobile (different formatting) is refused
do $$
begin
  perform public.loyalty_member_register('Other', 'Person', '0917-555-0101');
  raise exception 'duplicate mobile must fail';
exception when others then
  if sqlerrm not like '%already registered%' then raise; end if;
end $$;

-- validation
do $$
begin
  perform public.loyalty_member_register('NoLast', '', '09175550102');
  raise exception 'missing last name must fail';
exception when others then
  if sqlerrm not like '%first and last name%' then raise; end if;
end $$;
do $$
begin
  perform public.loyalty_member_register('Bad', 'Phone', '12345');
  raise exception 'bad mobile must fail';
exception when others then
  if sqlerrm not like '%valid mobile%' then raise; end if;
end $$;

-- kitchen staff cannot register members or look up QR codes
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000163', true);
do $$
begin
  perform public.loyalty_member_register('K', 'K', '09175550103');
  raise exception 'kitchen register must fail';
exception when others then
  if sqlerrm not like '%permission denied%' then raise; end if;
end $$;
do $$
begin
  perform public.loyalty_qr_lookup((select v from t16 where k = 'qr'));
  raise exception 'kitchen lookup must fail';
exception when others then
  if sqlerrm not like '%permission denied%' then raise; end if;
end $$;

-- --- tokens: stored hashed, QR lookup, revocation -------------------------------
reset role;
do $$
declare v_qr text := (select v from t16 where k = 'qr');
begin
  if exists (select 1 from public.loyalty_tokens where token_hash = v_qr) then
    raise exception 'raw token must never be stored';
  end if;
  if (select count(*) from public.loyalty_tokens
       where customer_id = (select v::uuid from t16 where k = 'cust') and revoked_at is null) <> 2 then
    raise exception 'expected one active qr + one active portal token';
  end if;
  if (select mobile from public.customers where id = (select v::uuid from t16 where k = 'cust'))
     <> '09175550101' then
    raise exception 'mobile should be stored normalized';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000161', true);
do $$
declare res jsonb;
begin
  res := public.loyalty_qr_lookup((select v from t16 where k = 'qr'));
  if res ->> 'full_name' <> 'Ana Reyes' or res ->> 'status' <> 'active' then
    raise exception 'lookup wrong: %', res;
  end if;
end $$;
-- the private portal token is not a QR code; garbage is refused the same way
do $$
begin
  perform public.loyalty_qr_lookup((select v from t16 where k = 'portal'));
  raise exception 'portal token as QR must fail';
exception when others then
  if sqlerrm not like '%not recognized%' then raise; end if;
end $$;
do $$
begin
  perform public.loyalty_qr_lookup('SPQ' || repeat('0', 64));
  raise exception 'unknown QR must fail';
exception when others then
  if sqlerrm not like '%not recognized%' then raise; end if;
end $$;

-- cashier cannot reissue; manager can, and the old QR dies
do $$
begin
  perform public.loyalty_member_reissue((select v::uuid from t16 where k = 'cust'), 'lost phone');
  raise exception 'cashier reissue must fail';
exception when others then
  if sqlerrm not like '%permission denied%' then raise; end if;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000162', true); -- manager
do $$
declare res jsonb; v_old text := (select v from t16 where k = 'qr');
begin
  res := public.loyalty_member_reissue((select v::uuid from t16 where k = 'cust'), 'lost phone');
  begin
    perform public.loyalty_qr_lookup(v_old);
    raise exception 'revoked QR must fail';
  exception when others then
    if sqlerrm not like '%not recognized%' then raise; end if;
  end;
  perform public.loyalty_qr_lookup(res ->> 'qr_token');
  update t16 set v = res ->> 'qr_token' where k = 'qr';
end $$;

-- internal helpers are not callable by signed-in clients
do $$
begin
  perform public.loyalty_token_mint((select v::uuid from t16 where k = 'cust'), 'qr');
  raise exception 'token_mint must be internal';
exception when insufficient_privilege then null;
end $$;
do $$
begin
  perform public.loyalty_post((select v::uuid from t16 where k = 'cust'), null, 'bonus', 500);
  raise exception 'loyalty_post must be internal';
exception when insufficient_privilege then null;
end $$;
reset role;
do $$
begin
  if has_function_privilege('anon', 'public.loyalty_member_register(text,text,text,text,date,boolean)', 'execute')
     or has_function_privilege('anon', 'public.loyalty_qr_lookup(text)', 'execute') then
    raise exception 'anon must not execute loyalty functions';
  end if;
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'loyalty_tokens'
              and not rowsecurity) then
    raise exception 'loyalty_tokens must have RLS on';
  end if;
end $$;

-- --- staff add a customer directly: name + member number are filled in ---------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000161', true);
insert into public.customers (first_name, last_name, mobile) values ('Ben', 'Cruz', '0917 555 0199');
do $$
begin
  if not exists (select 1 from public.customers
                  where full_name = 'Ben Cruz' and mobile = '09175550199' and member_no ~ '^SPM') then
    raise exception 'direct insert should sync name, mobile, member no';
  end if;
  insert into public.customers (first_name, last_name, mobile) values ('Dup', 'Cruz', '639175550199');
  raise exception 'duplicate mobile insert must fail';
exception when unique_violation then null;
end $$;

-- --- points engine ---------------------------------------------------------------
select public.shift_open(500);
-- ₱495 → 4 points (1 per ₱100, rounded down)
do $$
declare res jsonb; v_cust uuid := (select v::uuid from t16 where k = 'cust'); v_bal numeric;
begin
  res := public.pos_checkout(jsonb_build_object(
    'order_type', 'takeaway', 'customer_id', v_cust,
    'items', jsonb_build_array(jsonb_build_object(
      'product_id', 'a0000000-0000-0000-0000-000000002009', 'qty', 9)),  -- chips 55*9=495
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 495))
  ), gen_random_uuid());
  insert into t16 values ('order495', res ->> 'order_id');
  select points_balance into v_bal from public.loyalty_accounts where customer_id = v_cust;
  if v_bal <> 4 then raise exception '495 should earn 4, got %', v_bal; end if;
end $$;

-- a replayed "paid" transition can never award twice
reset role;
do $$
declare v_cust uuid := (select v::uuid from t16 where k = 'cust');
        v_order uuid := (select v::uuid from t16 where k = 'order495'); v_bal numeric;
begin
  update public.orders set payment_status = 'partial' where id = v_order;
  update public.orders set payment_status = 'paid' where id = v_order;
  select points_balance into v_bal from public.loyalty_accounts where customer_id = v_cust;
  if v_bal <> 4 then raise exception 'replayed payment double-awarded: %', v_bal; end if;
  if public.loyalty_post(v_cust, null, 'bonus', 10, 'promo', 'promo-key-1') is not true
     or public.loyalty_post(v_cust, null, 'bonus', 10, 'promo', 'promo-key-1') is not false then
    raise exception 'idempotency key should apply once';
  end if;
  select points_balance into v_bal from public.loyalty_accounts where customer_id = v_cust;
  if v_bal <> 14 then raise exception 'bonus should apply once, got %', v_bal; end if;
end $$;

-- ledger rows cannot be edited or deleted
do $$
begin
  update public.loyalty_transactions set points = 999 where idempotency_key = 'promo-key-1';
  raise exception 'ledger update must fail';
exception when others then
  if sqlerrm not like '%immutable%' then raise; end if;
end $$;

-- per-transaction cap, then exclusions: chips excluded → only the water share earns
update public.settings set value = value || jsonb_build_object('max_points_per_txn', 2)
 where key = 'loyalty';
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000161', true);
do $$
declare v_cust uuid := (select v::uuid from t16 where k = 'cust'); v_bal numeric;
begin
  perform public.pos_checkout(jsonb_build_object(
    'order_type', 'takeaway', 'customer_id', v_cust,
    'items', jsonb_build_array(jsonb_build_object(
      'product_id', 'a0000000-0000-0000-0000-000000002009', 'qty', 9)),
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 495))
  ), gen_random_uuid());
  select points_balance into v_bal from public.loyalty_accounts where customer_id = v_cust;
  if v_bal <> 16 then raise exception 'cap of 2 should give 16, got %', v_bal; end if;
end $$;
reset role;
update public.settings set value = value || jsonb_build_object(
  'max_points_per_txn', 0,
  'excluded_product_ids', jsonb_build_array('a0000000-0000-0000-0000-000000002009'))
 where key = 'loyalty';
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000161', true);
do $$
declare v_cust uuid := (select v::uuid from t16 where k = 'cust'); v_bal numeric;
begin
  perform public.pos_checkout(jsonb_build_object(
    'order_type', 'takeaway', 'customer_id', v_cust,
    'items', jsonb_build_array(
      jsonb_build_object('product_id', 'a0000000-0000-0000-0000-000000002009', 'qty', 9), -- 495 excluded
      jsonb_build_object('product_id', 'a0000000-0000-0000-0000-000000002007', 'qty', 5)), -- water 125
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 620))
  ), gen_random_uuid());
  select points_balance into v_bal from public.loyalty_accounts where customer_id = v_cust;
  if v_bal <> 17 then raise exception 'only eligible 125 should earn 1 → 17, got %', v_bal; end if;
end $$;
reset role;
update public.settings set value = value || jsonb_build_object('excluded_product_ids', '[]'::jsonb)
 where key = 'loyalty';

-- --- refunds: full refund takes back what the order earned ---------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000162', true); -- manager
select public.shift_open(500);
do $$
declare v_cust uuid := (select v::uuid from t16 where k = 'cust');
        v_order uuid := (select v::uuid from t16 where k = 'order495'); v_bal numeric;
begin
  perform public.order_refund(v_order, 200, 'cash', 'partial return', false, gen_random_uuid());
  select points_balance into v_bal from public.loyalty_accounts where customer_id = v_cust;
  -- 4 earned × 200/495 = 1.6 → 2 reversed
  if v_bal <> 15 then raise exception 'partial refund should leave 15, got %', v_bal; end if;
  perform public.order_refund(v_order, 295, 'cash', 'rest returned', false, gen_random_uuid());
  select points_balance into v_bal from public.loyalty_accounts where customer_id = v_cust;
  if v_bal <> 13 then raise exception 'full refund should reverse all 4 → 13, got %', v_bal; end if;
end $$;

-- --- suspension: no earning, status visible at lookup ---------------------------
do $$
declare v_cust uuid := (select v::uuid from t16 where k = 'cust'); v_bal numeric; res jsonb;
begin
  perform public.loyalty_member_set_status(v_cust, 'suspended', 'abuse investigation');
  perform public.pos_checkout(jsonb_build_object(
    'order_type', 'takeaway', 'customer_id', v_cust,
    'items', jsonb_build_array(jsonb_build_object(
      'product_id', 'a0000000-0000-0000-0000-000000002007', 'qty', 5)),  -- water 125
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 125))
  ), gen_random_uuid());
  select points_balance into v_bal from public.loyalty_accounts where customer_id = v_cust;
  if v_bal <> 13 then raise exception 'suspended member must not earn, got %', v_bal; end if;
  res := public.loyalty_qr_lookup((select v from t16 where k = 'qr'));
  if res ->> 'status' <> 'suspended' then raise exception 'lookup should show suspended'; end if;
  perform public.loyalty_member_set_status(v_cust, 'active', 'cleared');
end $$;

-- --- expiry: oldest points first -------------------------------------------------
reset role;
do $$
declare v_id uuid; v_expired numeric; v_bal numeric;
begin
  insert into public.customers (first_name, last_name, mobile)
  values ('Old', 'Timer', '09175550777') returning id into v_id;
  insert into public.loyalty_accounts (customer_id, points_balance) values (v_id, 12);
  insert into public.loyalty_transactions (customer_id, kind, points, note, created_at) values
    (v_id, 'earn', 10, 'old', now() - interval '400 days'),
    (v_id, 'redeem', -3, 'spent', now() - interval '300 days'),
    (v_id, 'earn', 5, 'recent', now() - interval '10 days');
  -- 10 old credits, 3 already spent from them → 7 expire; the recent 5 stay.
  v_expired := public.loyalty_expire_customer(v_id);
  select points_balance into v_bal from public.loyalty_accounts where customer_id = v_id;
  if v_expired <> 7 or v_bal <> 5 then
    raise exception 'expiry should take 7 and leave 5, got % / %', v_expired, v_bal;
  end if;
  if public.loyalty_expire_customer(v_id) <> 0 then
    raise exception 'expiry must not repeat';
  end if;
end $$;

-- --- every ledger sums to its cached balance ------------------------------------
do $$
declare v_bad int;
begin
  select count(*) into v_bad from public.loyalty_accounts a
   where a.points_balance <> (select coalesce(sum(points), 0)
                                from public.loyalty_transactions t
                               where t.customer_id = a.customer_id);
  if v_bad > 0 then raise exception '% loyalty accounts disagree with their ledger', v_bad; end if;
end $$;

rollback;
