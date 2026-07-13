-- 0009 Loyalty: point accounts, transaction ledger, earn-on-payment,
-- redemption support (used by pos_checkout), reversal on void/refund.

create table public.loyalty_accounts (
  customer_id uuid primary key references public.customers (id) on delete cascade,
  points_balance numeric(12,2) not null default 0,
  updated_at timestamptz not null default now()
);

create table public.loyalty_transactions (
  id bigint generated always as identity primary key,
  customer_id uuid not null references public.customers (id),
  order_id uuid references public.orders (id),
  kind text not null check (kind in
    ('earn', 'redeem', 'adjust', 'reverse_earn', 'reverse_redeem', 'birthday', 'expire')),
  points numeric(12,2) not null, -- signed: earn +, redeem −
  note text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index loyalty_tx_customer_idx on public.loyalty_transactions (customer_id, created_at desc);
create index loyalty_tx_order_idx on public.loyalty_transactions (order_id);

-- Internal: post a loyalty ledger row and keep the cached balance in sync.
create or replace function public.loyalty_post(
  p_customer uuid, p_order uuid, p_kind text, p_points numeric, p_note text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_points = 0 then return; end if;
  insert into public.loyalty_accounts (customer_id) values (p_customer)
  on conflict (customer_id) do nothing;
  insert into public.loyalty_transactions (customer_id, order_id, kind, points, note, created_by)
  values (p_customer, p_order, p_kind, p_points, p_note, auth.uid());
  update public.loyalty_accounts
     set points_balance = points_balance + p_points, updated_at = now()
   where customer_id = p_customer;
end $$;

-- Internal: redeem points against an order being posted (called by pos_checkout
-- inside the same transaction; rolls back with the order on failure).
-- Returns the peso discount amount.
create or replace function public.loyalty_redeem(
  p_order uuid, p_customer uuid, p_points numeric, p_base numeric
) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb := public.get_setting('loyalty');
  v_rate numeric := coalesce((cfg ->> 'redemption_value_per_point')::numeric, 1);
  v_max_pct numeric := coalesce((cfg ->> 'max_redemption_pct')::numeric, 1);
  v_balance numeric;
  v_amount numeric;
  v_points_used numeric;
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

-- Earn on payment completion (fires for POS sales and tab settlements alike).
create or replace function public.loyalty_on_order_paid() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb;
  v_points numeric;
begin
  if new.customer_id is null then return new; end if;
  if not (new.status = 'completed' and new.payment_status = 'paid'
          and old.payment_status is distinct from 'paid') then
    return new;
  end if;
  cfg := public.get_setting('loyalty');
  if not coalesce((cfg ->> 'enabled')::boolean, false) then return new; end if;
  if new.total < coalesce((cfg ->> 'min_purchase')::numeric, 0) then return new; end if;
  v_points := round(new.total * coalesce((cfg ->> 'points_per_peso')::numeric, 0), 2);
  if v_points > 0 then
    perform public.loyalty_post(new.customer_id, new.id, 'earn', v_points,
      'purchase ' || new.order_number);
  end if;
  return new;
end $$;

create trigger orders_loyalty_earn
  after update on public.orders
  for each row execute function public.loyalty_on_order_paid();

-- Reverse points when an order is voided (earned points removed, redeemed
-- points returned).
create or replace function public.loyalty_on_order_voided() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_earned numeric; v_redeemed numeric;
begin
  if not (new.status = 'voided' and old.status <> 'voided') then return new; end if;
  if new.customer_id is null then return new; end if;
  select coalesce(sum(points) filter (where kind = 'earn'), 0),
         coalesce(-sum(points) filter (where kind = 'redeem'), 0)
    into v_earned, v_redeemed
    from public.loyalty_transactions where order_id = new.id;
  if v_earned > 0 then
    perform public.loyalty_post(new.customer_id, new.id, 'reverse_earn', -v_earned,
      'void ' || new.order_number);
  end if;
  if v_redeemed > 0 then
    perform public.loyalty_post(new.customer_id, new.id, 'reverse_redeem', v_redeemed,
      'void ' || new.order_number);
  end if;
  return new;
end $$;

create trigger orders_loyalty_void
  after update on public.orders
  for each row execute function public.loyalty_on_order_voided();

-- Reverse earned points proportionally on refunds.
create or replace function public.loyalty_on_refund() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o public.orders%rowtype;
  v_earned numeric;
  v_reversal numeric;
begin
  select * into o from public.orders where id = new.order_id;
  if o.customer_id is null or o.total <= 0 then return new; end if;
  select coalesce(sum(points) filter (where kind = 'earn'), 0)
       + coalesce(sum(points) filter (where kind = 'reverse_earn'), 0)
    into v_earned
    from public.loyalty_transactions where order_id = o.id;
  if v_earned <= 0 then return new; end if;
  v_reversal := round(least(v_earned, v_earned * new.amount / o.total), 2);
  if v_reversal > 0 then
    perform public.loyalty_post(o.customer_id, o.id, 'reverse_earn', -v_reversal,
      'refund ' || new.refund_number);
  end if;
  return new;
end $$;

create trigger refunds_loyalty_reverse
  after insert on public.refunds
  for each row execute function public.loyalty_on_refund();

-- Manual adjustment with authorization.
create or replace function public.loyalty_adjust(
  p_customer uuid, p_points numeric, p_reason text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('loyalty.adjust') then
    raise exception 'permission denied: loyalty.adjust';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required for loyalty adjustments';
  end if;
  perform public.loyalty_post(p_customer, null, 'adjust', p_points, p_reason);
  perform public.log_audit('loyalty.adjust', 'loyalty_accounts', p_customer::text,
    null, jsonb_build_object('points', p_points), p_reason);
end $$;

grant select on public.loyalty_accounts, public.loyalty_transactions to authenticated;
grant all on public.loyalty_accounts, public.loyalty_transactions to service_role;

alter table public.loyalty_accounts enable row level security;
alter table public.loyalty_transactions enable row level security;

create policy loyalty_accounts_select on public.loyalty_accounts for select
  to authenticated using (
    public.has_permission('customers.view.basic') or public.has_permission('loyalty.manage')
  );
create policy loyalty_tx_select on public.loyalty_transactions for select
  to authenticated using (public.has_permission('loyalty.manage'));

grant execute on function public.loyalty_adjust(uuid, numeric, text) to authenticated;
