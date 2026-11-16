-- 0016 Loyalty stage 1: membership foundation.
--
--   * customers become loyalty members: first/last name, member number,
--     status (active/suspended), marketing consent, unique mobile.
--   * QR and portal access tokens are stored only as SHA-256 hashes
--     (the old raw customers.qr_token column is removed; nothing used it).
--   * Earning engine: N points per ₱X eligible spend, whole points, optional
--     product/category eligibility and per-transaction cap — all from the
--     `loyalty` settings row, nothing hardcoded.
--   * Ledger: idempotency key per entry (one earn per order, ever), immutable
--     rows, new `bonus` kind, FIFO expiry.
--
-- Undo script: supabase/rollbacks/0016_down.sql

-- ---------------------------------------------------------------------------
-- 1. Member fields on customers
-- ---------------------------------------------------------------------------
create or replace function public.normalize_mobile(p text) returns text
language sql immutable as $$
  select case
    when d ~ '^639\d{9}$' then '0' || substr(d, 3)
    when d ~ '^9\d{9}$' then '0' || d
    else nullif(d, '')
  end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;

create sequence if not exists public.member_no_seq;

alter table public.customers
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists member_no text,
  add column if not exists member_status text not null default 'active'
    check (member_status in ('active', 'suspended')),
  add column if not exists marketing_consent boolean not null default false,
  add column if not exists marketing_consent_at timestamptz;

-- Backfill names (last word = last name) and member numbers (oldest first).
update public.customers set
  first_name = case when position(' ' in btrim(full_name)) > 0
    then btrim(regexp_replace(btrim(full_name), '\s+\S+$', '')) else btrim(full_name) end,
  last_name = case when position(' ' in btrim(full_name)) > 0
    then substring(btrim(full_name) from '\S+$') else '' end
where first_name is null;

do $$
declare r record;
begin
  for r in select id from public.customers where member_no is null order by created_at, id loop
    update public.customers
       set member_no = 'SPM' || lpad(nextval('public.member_no_seq')::text, 6, '0')
     where id = r.id;
  end loop;
end $$;

alter table public.customers
  alter column member_no set default 'SPM' || lpad(nextval('public.member_no_seq')::text, 6, '0'),
  alter column member_no set not null;
create unique index if not exists customers_member_no_key on public.customers (member_no);

-- full_name stays the display name used across the POS; keep it in sync.
create or replace function public.customers_sync_name() returns trigger
language plpgsql as $$
begin
  if new.first_name is not null
     and (tg_op = 'INSERT'
          or new.first_name is distinct from old.first_name
          or new.last_name is distinct from old.last_name) then
    new.full_name := btrim(btrim(new.first_name) || ' ' || btrim(coalesce(new.last_name, '')));
  elsif new.full_name is not null
     and (tg_op = 'INSERT' or new.full_name is distinct from old.full_name) then
    new.first_name := case when position(' ' in btrim(new.full_name)) > 0
      then btrim(regexp_replace(btrim(new.full_name), '\s+\S+$', '')) else btrim(new.full_name) end;
    new.last_name := case when position(' ' in btrim(new.full_name)) > 0
      then substring(btrim(new.full_name) from '\S+$') else '' end;
  end if;
  if new.mobile is not null then
    new.mobile := coalesce(public.normalize_mobile(new.mobile), nullif(btrim(new.mobile), ''));
  end if;
  return new;
end $$;

drop trigger if exists customers_sync_name on public.customers;
create trigger customers_sync_name before insert or update on public.customers
  for each row execute function public.customers_sync_name();

update public.customers set mobile = public.normalize_mobile(mobile)
 where mobile is not null and mobile is distinct from public.normalize_mobile(mobile);

-- One membership per mobile number. If old data already has duplicates the
-- index is skipped (registration still refuses duplicates); fix them in
-- Customers, then re-run this file.
do $$
begin
  if exists (
    select 1 from public.customers
    where mobile is not null and archived_at is null
    group by mobile having count(*) > 1
  ) then
    raise notice 'duplicate mobile numbers exist — unique index NOT created';
  else
    create unique index if not exists customers_mobile_unique
      on public.customers (mobile) where mobile is not null and archived_at is null;
  end if;
end $$;

alter table public.customers drop column if exists qr_token;

-- ---------------------------------------------------------------------------
-- 2. Hashed access tokens (QR = shown to the cashier, portal = private link)
-- ---------------------------------------------------------------------------
create table if not exists public.loyalty_tokens (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  kind text not null check (kind in ('qr', 'portal')),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  revoked_at timestamptz
);
create unique index if not exists loyalty_tokens_one_active
  on public.loyalty_tokens (customer_id, kind) where revoked_at is null;

alter table public.loyalty_tokens enable row level security; -- no client policies
grant all on public.loyalty_tokens to service_role;

create or replace function public.loyalty_token_hash(p_token text) returns text
language sql immutable as $$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
$$;

-- Internal: revoke the active token of this kind and mint a new one.
-- Returns the raw token — the only time it ever exists outside the customer's hands.
create or replace function public.loyalty_token_mint(p_customer uuid, p_kind text)
returns text
language plpgsql security definer set search_path = public as $$
declare v_raw text;
begin
  update public.loyalty_tokens set revoked_at = now()
   where customer_id = p_customer and kind = p_kind and revoked_at is null;
  v_raw := case p_kind when 'qr' then 'SPQ' else 'SPP' end
    || upper(replace(gen_random_uuid()::text, '-', ''))
    || upper(replace(gen_random_uuid()::text, '-', ''));
  insert into public.loyalty_tokens (customer_id, kind, token_hash, created_by)
  values (p_customer, p_kind, public.loyalty_token_hash(v_raw), auth.uid());
  return v_raw;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Ledger hardening
-- ---------------------------------------------------------------------------
alter table public.loyalty_transactions
  add column if not exists idempotency_key text;

-- One earn per order: stamp existing earn rows, then enforce uniqueness.
update public.loyalty_transactions t set idempotency_key = 'earn:' || t.order_id
 where t.idempotency_key is null and t.kind = 'earn' and t.order_id is not null
   and t.id = (select min(id) from public.loyalty_transactions x
               where x.order_id = t.order_id and x.kind = 'earn');
update public.loyalty_transactions set idempotency_key = 'legacy:' || id
 where idempotency_key is null;
alter table public.loyalty_transactions
  alter column idempotency_key set default gen_random_uuid()::text,
  alter column idempotency_key set not null;
create unique index if not exists loyalty_tx_idem_key
  on public.loyalty_transactions (idempotency_key);

alter table public.loyalty_transactions drop constraint if exists loyalty_transactions_kind_check;
alter table public.loyalty_transactions add constraint loyalty_transactions_kind_check
  check (kind in ('earn', 'redeem', 'adjust', 'reverse_earn', 'reverse_redeem',
                  'birthday', 'bonus', 'expire'));

create or replace function public.loyalty_tx_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'loyalty transactions are immutable — post a correcting entry instead';
end $$;
drop trigger if exists loyalty_tx_no_update on public.loyalty_transactions;
create trigger loyalty_tx_no_update
  before update or delete on public.loyalty_transactions
  for each row execute function public.loyalty_tx_immutable();

-- Internal: post a ledger row and move the cached balance, atomically.
-- A repeated idempotency key is a silent no-op (no row, no balance change).
drop function if exists public.loyalty_post(uuid, uuid, text, numeric, text);
create or replace function public.loyalty_post(
  p_customer uuid, p_order uuid, p_kind text, p_points numeric,
  p_note text default null, p_idem text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if p_points = 0 then return false; end if;
  insert into public.loyalty_accounts (customer_id) values (p_customer)
  on conflict (customer_id) do nothing;
  insert into public.loyalty_transactions
    (customer_id, order_id, kind, points, note, created_by, idempotency_key)
  values (p_customer, p_order, p_kind, p_points, p_note, auth.uid(),
          coalesce(p_idem, gen_random_uuid()::text))
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  if v_id is null then return false; end if;
  update public.loyalty_accounts
     set points_balance = points_balance + p_points, updated_at = now()
   where customer_id = p_customer;
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Settings: new earning rule (1 point per ₱100 by default)
-- ---------------------------------------------------------------------------
update public.settings
   set value = (value - 'points_per_peso') || jsonb_build_object(
     'earn_points', 1, 'earn_per_amount', 100, 'max_points_per_txn', 0,
     'eligible_category_ids', '[]'::jsonb, 'eligible_product_ids', '[]'::jsonb,
     'excluded_product_ids', '[]'::jsonb)
 where key = 'loyalty' and not (value ? 'earn_per_amount');

-- Whole points an order earns under the current rules. Read-only.
create or replace function public.loyalty_points_for_order(p_order uuid) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  cfg jsonb := public.get_setting('loyalty');
  o public.orders%rowtype;
  v_per numeric := coalesce((cfg ->> 'earn_per_amount')::numeric, 0);
  v_pts numeric := coalesce((cfg ->> 'earn_points')::numeric, 0);
  v_max numeric := coalesce((cfg ->> 'max_points_per_txn')::numeric, 0);
  v_cats jsonb := coalesce(cfg -> 'eligible_category_ids', '[]'::jsonb);
  v_prods jsonb := coalesce(cfg -> 'eligible_product_ids', '[]'::jsonb);
  v_excl jsonb := coalesce(cfg -> 'excluded_product_ids', '[]'::jsonb);
  v_all numeric; v_elig numeric; v_base numeric; v_result numeric;
begin
  if not coalesce((cfg ->> 'enabled')::boolean, false) or v_per <= 0 or v_pts <= 0 then
    return 0;
  end if;
  select * into o from public.orders where id = p_order;
  if not found or o.total <= 0 then return 0; end if;

  -- Eligible share of the bill, applied to the final total (after discounts).
  select coalesce(sum(i.line_total), 0),
         coalesce(sum(i.line_total) filter (where
           not (v_excl ? i.product_id::text)
           and ((jsonb_array_length(v_cats) = 0 and jsonb_array_length(v_prods) = 0)
                or v_prods ? i.product_id::text
                or v_cats ? p.category_id::text)), 0)
    into v_all, v_elig
    from public.order_items i join public.products p on p.id = i.product_id
   where i.order_id = p_order;
  if v_all <= 0 then return 0; end if;
  v_base := o.total * v_elig / v_all;

  if v_base < coalesce((cfg ->> 'min_purchase')::numeric, 0) then return 0; end if;
  v_result := floor(v_base / v_per) * v_pts;
  if v_max > 0 then v_result := least(v_result, v_max); end if;
  return floor(v_result);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Expiry — oldest points first. Applied lazily whenever a member's
--    balance is about to be used or shown, so no scheduler is needed.
-- ---------------------------------------------------------------------------
create or replace function public.loyalty_expire_customer(p_customer uuid) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_days numeric := coalesce((public.get_setting('loyalty') ->> 'points_expiry_days')::numeric, 0);
  v_old_credits numeric; v_debits numeric; v_balance numeric; v_due numeric;
begin
  if v_days <= 0 then return 0; end if;
  select points_balance into v_balance from public.loyalty_accounts
   where customer_id = p_customer for update;
  if v_balance is null or v_balance <= 0 then return 0; end if;
  select coalesce(sum(points) filter (where points > 0
                    and created_at < now() - make_interval(days => v_days::int)), 0),
         coalesce(-sum(points) filter (where points < 0), 0)
    into v_old_credits, v_debits
    from public.loyalty_transactions where customer_id = p_customer;
  -- Everything ever spent, reversed, or expired is taken from the oldest credits first.
  v_due := floor(least(v_old_credits - v_debits, v_balance));
  if v_due <= 0 then return 0; end if;
  perform public.loyalty_post(p_customer, null, 'expire', -v_due,
    'expired after ' || v_days::int || ' days');
  return v_due;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Earn / reverse triggers on the new engine
-- ---------------------------------------------------------------------------
create or replace function public.loyalty_on_order_paid() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_points numeric;
begin
  if new.customer_id is null then return new; end if;
  if not (new.status = 'completed' and new.payment_status = 'paid'
          and old.payment_status is distinct from 'paid') then
    return new;
  end if;
  if (select member_status from public.customers where id = new.customer_id) <> 'active' then
    return new;
  end if;
  v_points := public.loyalty_points_for_order(new.id);
  if v_points > 0 then
    perform public.loyalty_expire_customer(new.customer_id);
    -- Keyed on the order: a replayed payment can never award twice.
    perform public.loyalty_post(new.customer_id, new.id, 'earn', v_points,
      'purchase ' || new.order_number, 'earn:' || new.id);
  end if;
  return new;
end $$;

-- Refunds take back a proportional share of what the order earned, in whole
-- points. If those points were already spent the balance goes negative and
-- redemption stays blocked until it is positive again.
create or replace function public.loyalty_on_refund() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o public.orders%rowtype;
  v_earned numeric; v_remaining numeric; v_reversal numeric;
begin
  select * into o from public.orders where id = new.order_id;
  if o.customer_id is null or o.total <= 0 then return new; end if;
  select coalesce(sum(points) filter (where kind = 'earn'), 0),
         coalesce(sum(points) filter (where kind in ('earn', 'reverse_earn')), 0)
    into v_earned, v_remaining
    from public.loyalty_transactions where order_id = o.id;
  if v_remaining <= 0 then return new; end if;
  v_reversal := least(v_remaining, round(v_earned * new.amount / o.total));
  if v_reversal > 0 then
    perform public.loyalty_post(o.customer_id, o.id, 'reverse_earn', -v_reversal,
      'refund ' || new.refund_number, 'refund:' || new.id);
  end if;
  return new;
end $$;

-- Points-as-discount (kept until the rewards catalog replaces it in stage 4):
-- suspended members cannot redeem, and expiry is applied first.
create or replace function public.loyalty_redeem(
  p_order uuid, p_customer uuid, p_points numeric, p_base numeric
) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb := public.get_setting('loyalty');
  v_rate numeric := coalesce((cfg ->> 'redemption_value_per_point')::numeric, 1);
  v_max_pct numeric := coalesce((cfg ->> 'max_redemption_pct')::numeric, 1);
  v_balance numeric; v_amount numeric; v_points_used numeric;
begin
  if not coalesce((cfg ->> 'enabled')::boolean, false) then
    raise exception 'the loyalty program is disabled';
  end if;
  if p_customer is null then
    raise exception 'loyalty redemption needs a customer on the order';
  end if;
  if p_points is null or p_points <= 0 then
    raise exception 'invalid loyalty points amount';
  end if;
  if (select member_status from public.customers where id = p_customer) <> 'active' then
    raise exception 'this membership is suspended';
  end if;
  perform public.loyalty_expire_customer(p_customer);

  select points_balance into v_balance from public.loyalty_accounts
   where customer_id = p_customer for update;
  if v_balance is null or v_balance < p_points then
    raise exception 'not enough loyalty points (balance: %)', coalesce(v_balance, 0);
  end if;

  v_amount := round(least(p_points * v_rate, p_base * v_max_pct), 2);
  if v_amount <= 0 then raise exception 'nothing to redeem'; end if;
  v_points_used := round(v_amount / v_rate, 2);

  perform public.loyalty_post(p_customer, p_order, 'redeem', -v_points_used, 'redeemed at POS');
  return v_amount;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Membership functions (staff today; the public join page in stage 2
--    calls register with the service-role key)
-- ---------------------------------------------------------------------------
create or replace function public.loyalty_member_register(
  p_first text, p_last text, p_mobile text,
  p_email text default null, p_birthday date default null, p_consent boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_mobile text := public.normalize_mobile(p_mobile);
  v_id uuid; v_no text;
begin
  -- anon has no EXECUTE at all; a signed-in caller must be customer-facing staff;
  -- no uid means the server-side service role.
  if auth.uid() is not null and not public.has_permission('customers.view.basic') then
    raise exception 'permission denied: customers.view.basic';
  end if;
  if coalesce(btrim(p_first), '') = '' or coalesce(btrim(p_last), '') = '' then
    raise exception 'first and last name are required';
  end if;
  if v_mobile is null or v_mobile !~ '^09\d{9}$' then
    raise exception 'enter a valid mobile number (09XXXXXXXXX)';
  end if;
  -- Serialize registrations for the same number.
  perform pg_advisory_xact_lock(hashtext('loyalty_register:' || v_mobile));
  if exists (select 1 from public.customers where mobile = v_mobile and archived_at is null) then
    raise exception 'this mobile number is already registered';
  end if;

  insert into public.customers
    (first_name, last_name, full_name, mobile, email, birthday,
     marketing_consent, marketing_consent_at)
  values (btrim(p_first), btrim(p_last), btrim(p_first) || ' ' || btrim(p_last), v_mobile,
          nullif(btrim(coalesce(p_email, '')), ''), p_birthday,
          coalesce(p_consent, false), case when p_consent then now() end)
  returning id, member_no into v_id, v_no;
  insert into public.loyalty_accounts (customer_id) values (v_id)
  on conflict (customer_id) do nothing;

  perform public.log_audit('loyalty.member.register', 'customers', v_id::text,
    null, jsonb_build_object('member_no', v_no), null);
  return jsonb_build_object(
    'customer_id', v_id, 'member_no', v_no,
    'qr_token', public.loyalty_token_mint(v_id, 'qr'),
    'portal_token', public.loyalty_token_mint(v_id, 'portal'));
end $$;

-- Counter recovery: revoke the member's QR and private link, issue new ones.
create or replace function public.loyalty_member_reissue(p_customer uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('customers.manage') then
    raise exception 'permission denied: customers.manage';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required to reissue membership access';
  end if;
  if not exists (select 1 from public.customers where id = p_customer and archived_at is null) then
    raise exception 'unknown member';
  end if;
  perform public.log_audit('loyalty.member.reissue', 'customers', p_customer::text,
    null, null, p_reason);
  return jsonb_build_object(
    'qr_token', public.loyalty_token_mint(p_customer, 'qr'),
    'portal_token', public.loyalty_token_mint(p_customer, 'portal'));
end $$;

create or replace function public.loyalty_member_set_status(
  p_customer uuid, p_status text, p_reason text
) returns void
language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  if not public.has_permission('customers.manage') then
    raise exception 'permission denied: customers.manage';
  end if;
  if p_status not in ('active', 'suspended') then
    raise exception 'invalid membership status';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required to change membership status';
  end if;
  select member_status into v_old from public.customers where id = p_customer for update;
  if not found then raise exception 'unknown member'; end if;
  update public.customers set member_status = p_status where id = p_customer;
  perform public.log_audit('loyalty.member.status', 'customers', p_customer::text,
    jsonb_build_object('status', v_old), jsonb_build_object('status', p_status), p_reason);
end $$;

-- Cashier scans a membership QR → who is this? Unknown and revoked codes look identical.
create or replace function public.loyalty_qr_lookup(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.customers%rowtype;
begin
  if not (public.has_permission('pos.sell') or public.has_permission('customers.view.basic')) then
    raise exception 'permission denied: pos.sell';
  end if;
  select cu.* into c
    from public.loyalty_tokens t join public.customers cu on cu.id = t.customer_id
   where t.token_hash = public.loyalty_token_hash(p_token)
     and t.kind = 'qr' and t.revoked_at is null and cu.archived_at is null;
  if not found then raise exception 'membership QR not recognized'; end if;
  perform public.loyalty_expire_customer(c.id);
  return jsonb_build_object(
    'customer_id', c.id, 'member_no', c.member_no, 'full_name', c.full_name,
    'status', c.member_status,
    'points_balance', coalesce((select points_balance from public.loyalty_accounts
                                 where customer_id = c.id), 0));
end $$;

-- ---------------------------------------------------------------------------
-- 8. Grants — deny by default (see 0015), then allow the app's entry points.
-- ---------------------------------------------------------------------------
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'normalize_mobile', 'customers_sync_name', 'loyalty_token_hash', 'loyalty_token_mint',
        'loyalty_tx_immutable', 'loyalty_post', 'loyalty_points_for_order',
        'loyalty_expire_customer', 'loyalty_redeem', 'loyalty_member_register',
        'loyalty_member_reissue', 'loyalty_member_set_status', 'loyalty_qr_lookup')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;

grant execute on function
  public.loyalty_member_register(text, text, text, text, date, boolean),
  public.loyalty_member_reissue(uuid, text),
  public.loyalty_member_set_status(uuid, text, text),
  public.loyalty_qr_lookup(text)
to authenticated;
grant execute on function
  public.loyalty_member_register(text, text, text, text, date, boolean),
  public.loyalty_token_hash(text),
  public.loyalty_expire_customer(uuid),
  public.normalize_mobile(text)
to service_role;
-- The customers trigger normalizes mobiles for direct staff inserts.
grant execute on function public.normalize_mobile(text) to authenticated;
grant usage on sequence public.member_no_seq to authenticated, service_role;
