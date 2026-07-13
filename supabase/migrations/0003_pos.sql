-- 0003 POS: payment methods, customers (basic), tabs, shifts (structure),
-- orders, order items/modifiers/discounts, payments, and the atomic
-- pos_checkout / tab_settle RPCs.
--
-- Design note: KDS "tickets" are the completed orders' prepared items grouped
-- by station — order_items carry station + prep status directly, so there is
-- no separate ticket table to drift out of sync.

-- ---------------------------------------------------------------------------
-- Payment methods (owner-configurable)
-- ---------------------------------------------------------------------------
create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  kind text not null check (kind in ('cash', 'ewallet', 'card', 'bank', 'comp', 'other')),
  requires_reference boolean not null default false,
  is_active boolean not null default true,
  sort_order int not null default 0
);

insert into public.payment_methods (code, name, kind, requires_reference, sort_order) values
  ('cash', 'Cash', 'cash', false, 1),
  ('gcash', 'GCash', 'ewallet', true, 2),
  ('maya', 'Maya', 'ewallet', true, 3),
  ('card', 'Debit / Credit Card', 'card', true, 4),
  ('bank', 'Bank Transfer', 'bank', true, 5),
  ('comp', 'Complimentary', 'comp', false, 6);

-- ---------------------------------------------------------------------------
-- Customers (profile basics; loyalty ledger arrives in 0008)
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  mobile text,
  email text,
  birthday date,
  notes text,
  qr_token uuid not null default gen_random_uuid() unique,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger customers_updated_at before update on public.customers
  for each row execute function public.set_updated_at();
create index customers_mobile_idx on public.customers (mobile);

-- ---------------------------------------------------------------------------
-- Shifts (structure now; reconciliation RPCs in 0006)
-- ---------------------------------------------------------------------------
create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  cashier_id uuid not null references public.profiles (id),
  terminal text not null default 'Main',
  status text not null default 'open' check (status in ('open', 'closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opening_cash numeric(12,2) not null default 0 check (opening_cash >= 0),
  expected_cash numeric(12,2),
  actual_cash numeric(12,2),
  variance numeric(12,2),
  variance_reason text,
  totals_snapshot jsonb,
  notes text
);
create unique index shifts_one_open_per_cashier
  on public.shifts (cashier_id) where status = 'open';

create or replace function public.shift_open(
  p_opening_cash numeric, p_terminal text default 'Main', p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.has_permission('shifts.own') then
    raise exception 'permission denied: shifts.own';
  end if;
  if p_opening_cash < 0 then raise exception 'opening cash cannot be negative'; end if;
  insert into public.shifts (cashier_id, terminal, opening_cash, notes)
  values (auth.uid(), coalesce(p_terminal, 'Main'), p_opening_cash, p_notes)
  returning id into v_id;
  perform public.log_audit('shift.open', 'shifts', v_id::text, null,
    jsonb_build_object('opening_cash', p_opening_cash, 'terminal', p_terminal));
  return v_id;
exception when unique_violation then
  raise exception 'you already have an open shift';
end $$;

-- ---------------------------------------------------------------------------
-- Tabs
-- ---------------------------------------------------------------------------
create table public.tabs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  customer_id uuid references public.customers (id),
  status text not null default 'open' check (status in ('open', 'closed')),
  opened_by uuid not null references public.profiles (id),
  closed_by uuid references public.profiles (id),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  notes text
);
create index tabs_status_idx on public.tabs (status);

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
create type public.order_type as enum ('dine_in', 'takeaway', 'courtside', 'tab');
create type public.order_status as enum ('open', 'held', 'completed', 'voided', 'cancelled');
create type public.item_prep_status as enum
  ('new', 'accepted', 'preparing', 'ready', 'served', 'cancelled');

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  order_type public.order_type not null,
  status public.order_status not null default 'open',
  tab_id uuid references public.tabs (id),
  customer_id uuid references public.customers (id),
  courtside_label text,
  notes text,
  subtotal numeric(12,2) not null default 0,
  discount_total numeric(12,2) not null default 0,
  tax_total numeric(12,2) not null default 0,
  service_charge numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  amount_paid numeric(12,2) not null default 0,
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'partial', 'paid')),
  cogs_total numeric(12,2) not null default 0,
  tax_snapshot jsonb,
  shift_id uuid references public.shifts (id),
  created_by uuid not null references public.profiles (id),
  completed_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  idempotency_key uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();
create index orders_status_idx on public.orders (status, created_at desc);
create index orders_tab_idx on public.orders (tab_id) where tab_id is not null;
create index orders_shift_idx on public.orders (shift_id);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid not null references public.products (id),
  variant_id uuid references public.product_variants (id),
  product_name text not null,          -- snapshot
  variant_name text,                   -- snapshot
  qty numeric(10,2) not null check (qty > 0),
  unit_price numeric(12,2) not null,   -- snapshot: product + variant delta
  modifiers_price numeric(12,2) not null default 0, -- snapshot: Σ option deltas
  line_total numeric(12,2) not null,   -- qty * (unit_price + modifiers_price)
  cost_total numeric(12,2) not null default 0, -- filled at completion
  station public.prep_station not null default 'none',
  prep_status public.item_prep_status not null default 'new',
  prep_status_at timestamptz not null default now(),
  notes text,
  added_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);
create index order_items_order_idx on public.order_items (order_id);
create index order_items_kds_idx on public.order_items (station, prep_status)
  where station <> 'none';

create table public.order_item_modifiers (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items (id) on delete cascade,
  option_id uuid references public.modifier_options (id),
  option_name text not null,           -- snapshot
  group_name text not null default '', -- snapshot
  price_delta numeric(12,2) not null default 0
);
create index order_item_modifiers_item_idx on public.order_item_modifiers (order_item_id);

create table public.order_discounts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  discount_type text not null check (discount_type in
    ('percent', 'fixed', 'senior', 'pwd', 'loyalty', 'promo', 'comp', 'manual')),
  value numeric(12,4) not null,        -- percent (0-1) or peso amount
  amount numeric(12,2) not null,       -- computed peso discount
  reason text,
  id_reference text,                   -- SC/PWD ID number where legally appropriate
  authorized_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders (id),
  tab_id uuid references public.tabs (id),
  method_id uuid not null references public.payment_methods (id),
  amount numeric(12,2) not null check (amount > 0),
  reference_no text,
  tendered numeric(12,2),
  change numeric(12,2),
  cashier_id uuid not null references public.profiles (id),
  shift_id uuid references public.shifts (id),
  status text not null default 'posted' check (status in ('posted', 'voided', 'refunded')),
  idempotency_key uuid unique,
  created_at timestamptz not null default now(),
  constraint payment_target check (order_id is not null or tab_id is not null)
);
create index payments_shift_idx on public.payments (shift_id);
create index payments_order_idx on public.payments (order_id);

-- ---------------------------------------------------------------------------
-- Internal: compute + post one order from a JSON cart. Used by pos_checkout.
-- ---------------------------------------------------------------------------
create or replace function public.pos_checkout(
  p_payload jsonb, p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_existing public.orders%rowtype;
  v_order_id uuid;
  v_order_number text;
  v_type public.order_type;
  v_hold boolean;
  v_tab_id uuid;
  v_shift public.shifts%rowtype;
  v_tax jsonb;
  v_item jsonb;
  v_mod jsonb;
  v_disc jsonb;
  v_pay jsonb;
  v_product public.products%rowtype;
  v_variant public.product_variants%rowtype;
  v_option public.modifier_options%rowtype;
  v_group_name text;
  v_qty numeric;
  v_unit_price numeric;
  v_mod_price numeric;
  v_line_total numeric;
  v_subtotal numeric := 0;
  v_discount_total numeric := 0;
  v_disc_amount numeric;
  v_taxable numeric;
  v_tax_total numeric := 0;
  v_service numeric := 0;
  v_total numeric;
  v_order_item_id uuid;
  v_station public.prep_station;
  v_item_cost numeric;
  v_cogs numeric := 0;
  v_method public.payment_methods%rowtype;
  v_pay_total numeric := 0;
  v_tendered numeric;
  v_change numeric;
  v_customer uuid;
  v_sc_pwd boolean := false;
  -- aggregated ingredient consumption: item_id -> qty
  v_consume jsonb := '{}'::jsonb;
  v_key text;
  v_need numeric;
  r record;
begin
  if not public.has_permission('pos.sell') then
    raise exception 'permission denied: pos.sell';
  end if;

  -- Idempotent replay: return the original result.
  select * into v_existing from public.orders where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('order_id', v_existing.id,
      'order_number', v_existing.order_number, 'total', v_existing.total,
      'replayed', true);
  end if;

  v_type := (p_payload ->> 'order_type')::public.order_type;
  v_hold := coalesce((p_payload ->> 'hold')::boolean, false);
  v_customer := nullif(p_payload ->> 'customer_id', '')::uuid;

  -- Cashier must have an open shift to post sales (held orders exempt).
  select * into v_shift from public.shifts
   where cashier_id = auth.uid() and status = 'open';
  if not found and not v_hold then
    raise exception 'open a shift before posting sales';
  end if;

  -- Tab handling: attach to an existing open tab or create a named one.
  if v_type = 'tab' or (p_payload ->> 'tab_id') is not null or (p_payload ->> 'tab_name') is not null then
    v_tab_id := nullif(p_payload ->> 'tab_id', '')::uuid;
    if v_tab_id is null then
      if coalesce(btrim(p_payload ->> 'tab_name'), '') = '' then
        raise exception 'tab orders need a tab name';
      end if;
      insert into public.tabs (name, customer_id, opened_by, notes)
      values (btrim(p_payload ->> 'tab_name'), v_customer, auth.uid(), p_payload ->> 'tab_notes')
      returning id into v_tab_id;
    else
      perform 1 from public.tabs where id = v_tab_id and status = 'open' for update;
      if not found then raise exception 'tab is not open'; end if;
    end if;
    v_type := 'tab';
  end if;

  v_tax := public.get_setting('tax');
  v_order_number := public.next_doc_number('order');

  insert into public.orders
    (order_number, order_type, status, tab_id, customer_id, courtside_label, notes,
     tax_snapshot, shift_id, created_by, idempotency_key)
  values
    (v_order_number, v_type, 'open', v_tab_id, v_customer,
     nullif(p_payload ->> 'courtside_label', ''), nullif(p_payload ->> 'notes', ''),
     v_tax, v_shift.id, auth.uid(), p_idempotency_key)
  returning id into v_order_id;

  -- ------------------------------------------------------------------ items
  if jsonb_array_length(coalesce(p_payload -> 'items', '[]'::jsonb)) = 0 then
    raise exception 'order has no items';
  end if;

  for v_item in select * from jsonb_array_elements(p_payload -> 'items') loop
    select * into v_product from public.products
     where id = (v_item ->> 'product_id')::uuid and archived_at is null;
    if not found then raise exception 'unknown product in cart'; end if;
    if not v_product.is_available then
      raise exception '% is currently unavailable', v_product.name;
    end if;

    v_qty := (v_item ->> 'qty')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'invalid quantity'; end if;

    v_variant := null;
    if nullif(v_item ->> 'variant_id', '') is not null then
      select * into v_variant from public.product_variants
       where id = (v_item ->> 'variant_id')::uuid and product_id = v_product.id;
      if not found then raise exception 'unknown variant for %', v_product.name; end if;
    end if;

    -- Server-side pricing (never trust the client).
    v_unit_price := v_product.price + coalesce(v_variant.price_delta, 0);
    v_mod_price := 0;
    v_station := v_product.station;

    v_order_item_id := gen_random_uuid();

    -- pass 1: price + station from modifiers (validated)
    declare v_mod_rows jsonb := '[]'::jsonb;
    begin
      for v_mod in select * from jsonb_array_elements(coalesce(v_item -> 'modifier_option_ids', '[]'::jsonb)) loop
        select o.* into v_option from public.modifier_options o
         where o.id = (v_mod #>> '{}')::uuid;
        if not found then raise exception 'unknown modifier option'; end if;
        if not v_option.is_available then
          raise exception 'modifier % is unavailable', v_option.name;
        end if;
        select g.name into v_group_name from public.modifier_groups g where g.id = v_option.group_id;
        v_mod_price := v_mod_price + v_option.price_delta;
        if v_option.station_override is not null then
          v_station := v_option.station_override;
        end if;
        v_mod_rows := v_mod_rows || jsonb_build_object(
          'option_id', v_option.id, 'option_name', v_option.name,
          'group_name', coalesce(v_group_name, ''), 'price_delta', v_option.price_delta);
      end loop;

      v_line_total := round(v_qty * (v_unit_price + v_mod_price), 2);
      v_subtotal := v_subtotal + v_line_total;

      insert into public.order_items
        (id, order_id, product_id, variant_id, product_name, variant_name, qty,
         unit_price, modifiers_price, line_total, station, notes, added_by)
      values
        (v_order_item_id, v_order_id, v_product.id, v_variant.id, v_product.name,
         v_variant.name, v_qty, v_unit_price, v_mod_price, v_line_total,
         v_station, nullif(v_item ->> 'notes', ''), auth.uid());

      -- pass 2: modifier snapshots (parent row now exists)
      insert into public.order_item_modifiers
        (order_item_id, option_id, option_name, group_name, price_delta)
      select v_order_item_id, (m ->> 'option_id')::uuid, m ->> 'option_name',
             m ->> 'group_name', (m ->> 'price_delta')::numeric
      from jsonb_array_elements(v_mod_rows) m;
    end;
  end loop;

  -- --------------------------------------------------------------- discounts
  for v_disc in select * from jsonb_array_elements(coalesce(p_payload -> 'discounts', '[]'::jsonb)) loop
    declare
      v_dtype text := v_disc ->> 'type';
      v_value numeric := coalesce((v_disc ->> 'value')::numeric, 0);
    begin
      if v_dtype in ('percent', 'manual', 'promo') then
        if v_dtype in ('manual') and not public.has_permission('pos.discount.manual') then
          raise exception 'manual discounts need manager authorization';
        end if;
        if v_value < 0 or v_value > 1 then raise exception 'percent discount must be 0-1'; end if;
        v_disc_amount := round((v_subtotal - v_discount_total) * v_value, 2);
      elsif v_dtype = 'fixed' then
        if not public.has_permission('pos.discount.manual') then
          raise exception 'fixed discounts need manager authorization';
        end if;
        v_disc_amount := least(v_value, v_subtotal - v_discount_total);
      elsif v_dtype in ('senior', 'pwd') then
        v_value := coalesce((v_tax ->> 'sc_pwd_discount_rate')::numeric, 0.20);
        v_disc_amount := round((v_subtotal - v_discount_total) * v_value, 2);
        v_sc_pwd := true;
        if coalesce(btrim(v_disc ->> 'id_reference'), '') = '' then
          raise exception 'SC/PWD discounts require an ID reference';
        end if;
      elsif v_dtype = 'comp' then
        if not public.has_permission('pos.discount.manual') then
          raise exception 'complimentary orders need manager authorization';
        end if;
        v_disc_amount := v_subtotal - v_discount_total;
      else
        raise exception 'unsupported discount type %', v_dtype;
      end if;

      v_discount_total := v_discount_total + v_disc_amount;
      insert into public.order_discounts
        (order_id, discount_type, value, amount, reason, id_reference, authorized_by)
      values (v_order_id, v_dtype, v_value, v_disc_amount,
              v_disc ->> 'reason', v_disc ->> 'id_reference', auth.uid());
    end;
  end loop;

  if v_discount_total > v_subtotal then
    raise exception 'discounts exceed the order subtotal';
  end if;

  -- --------------------------------------------------------------------- tax
  v_taxable := v_subtotal - v_discount_total;
  if coalesce((v_tax ->> 'vat_registered')::boolean, false)
     and not (v_sc_pwd and coalesce((v_tax ->> 'sc_pwd_vat_exempt')::boolean, true)) then
    if coalesce(v_tax ->> 'pricing_mode', 'tax_inclusive') = 'tax_inclusive' then
      v_tax_total := round(v_taxable * (v_tax ->> 'vat_rate')::numeric
                           / (1 + (v_tax ->> 'vat_rate')::numeric), 2);
      v_total := v_taxable; -- tax already inside
    else
      v_tax_total := round(v_taxable * (v_tax ->> 'vat_rate')::numeric, 2);
      v_total := v_taxable + v_tax_total;
    end if;
  else
    v_total := v_taxable;
  end if;

  v_service := round((v_subtotal - v_discount_total)
                     * coalesce((v_tax ->> 'service_charge_rate')::numeric, 0), 2);
  v_total := v_total + v_service;

  update public.orders set
    subtotal = v_subtotal, discount_total = v_discount_total,
    tax_total = v_tax_total, service_charge = v_service, total = v_total
  where id = v_order_id;

  -- ------------------------------------------------------------------- hold?
  if v_hold then
    update public.orders set status = 'held' where id = v_order_id;
    return jsonb_build_object('order_id', v_order_id, 'order_number', v_order_number,
      'total', v_total, 'held', true);
  end if;

  -- ----------------------------------------------------------------- payments
  for v_pay in select * from jsonb_array_elements(coalesce(p_payload -> 'payments', '[]'::jsonb)) loop
    select * into v_method from public.payment_methods
     where code = v_pay ->> 'method' and is_active;
    if not found then raise exception 'unknown payment method %', v_pay ->> 'method'; end if;
    if v_method.requires_reference and coalesce(btrim(v_pay ->> 'reference_no'), '') = '' then
      raise exception '% payments need a reference number', v_method.name;
    end if;
    if v_method.kind = 'comp' and not public.has_permission('pos.discount.manual') then
      raise exception 'complimentary payment needs manager authorization';
    end if;

    v_tendered := nullif(v_pay ->> 'tendered', '')::numeric;
    v_change := case when v_tendered is not null
      then round(v_tendered - (v_pay ->> 'amount')::numeric, 2) end;
    if v_change is not null and v_change < 0 then
      raise exception 'tendered cash is less than the amount due';
    end if;

    insert into public.payments
      (order_id, method_id, amount, reference_no, tendered, change,
       cashier_id, shift_id)
    values
      (v_order_id, v_method.id, (v_pay ->> 'amount')::numeric,
       nullif(v_pay ->> 'reference_no', ''), v_tendered, v_change,
       auth.uid(), v_shift.id);
    v_pay_total := v_pay_total + (v_pay ->> 'amount')::numeric;
  end loop;

  -- Immediate orders must be fully paid; tab orders may defer payment.
  if v_type <> 'tab' then
    if round(v_pay_total, 2) <> round(v_total, 2) then
      raise exception 'payment (%) does not match order total (%)', v_pay_total, v_total;
    end if;
  else
    if v_pay_total > 0 and round(v_pay_total, 2) <> round(v_total, 2) then
      raise exception 'tab orders are paid in full or not at all at posting';
    end if;
  end if;

  -- ------------------------------------------------- inventory (aggregate)
  -- Build item_id -> qty consumption map: retail units, recipe lines
  -- (variant-aware, waste allowance included), and modifier effects.
  for r in
    select oi.id as order_item_id, oi.qty, oi.product_id, oi.variant_id, p.kind,
           p.inventory_item_id
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    where oi.order_id = v_order_id
  loop
    v_item_cost := 0;

    if r.kind = 'retail' then
      v_item_cost := public.consume_stock(r.inventory_item_id, r.qty, 'sale',
        'order', v_order_id::text);
    else
      -- recipe lines applicable to this variant
      declare
        line record;
        v_line_qty numeric;
        v_fx record;
      begin
        for line in
          select ri.item_id, ri.qty, ri.waste_pct
          from public.recipe_ingredients ri
          where ri.product_id = r.product_id
            and (ri.variant_id is null or ri.variant_id = r.variant_id)
        loop
          v_line_qty := round(line.qty * (1 + line.waste_pct / 100) * r.qty, 4);
          -- apply modifier remove/replace effects
          for v_fx in
            select e.remove_item_id, e.remove_qty
            from public.order_item_modifiers oim
            join public.modifier_option_effects e on e.option_id = oim.option_id
            where oim.order_item_id = r.order_item_id
              and e.remove_item_id = line.item_id
          loop
            v_line_qty := greatest(0, v_line_qty - v_fx.remove_qty * r.qty);
          end loop;
          if v_line_qty > 0 then
            v_item_cost := v_item_cost + public.consume_stock(line.item_id, v_line_qty,
              'recipe_consumption', 'order', v_order_id::text);
          end if;
        end loop;

        -- modifier additions
        for v_fx in
          select e.add_item_id, e.add_qty
          from public.order_item_modifiers oim
          join public.modifier_option_effects e on e.option_id = oim.option_id
          where oim.order_item_id = r.order_item_id
            and e.add_item_id is not null
        loop
          v_item_cost := v_item_cost + public.consume_stock(v_fx.add_item_id,
            round(v_fx.add_qty * r.qty, 4), 'recipe_consumption', 'order', v_order_id::text);
        end loop;
      end;
    end if;

    update public.order_items
       set cost_total = round(v_item_cost, 2) where id = r.order_item_id;
    v_cogs := v_cogs + v_item_cost;
  end loop;

  -- ----------------------------------------------------------------- finalize
  update public.orders set
    status = 'completed',
    completed_at = now(),
    cogs_total = round(v_cogs, 2),
    amount_paid = v_pay_total,
    payment_status = case
      when round(v_pay_total, 2) >= round(v_total, 2) then 'paid'
      when v_pay_total > 0 then 'partial'
      else 'unpaid' end
  where id = v_order_id;

  return jsonb_build_object('order_id', v_order_id, 'order_number', v_order_number,
    'total', v_total, 'cogs', round(v_cogs, 2));
end $$;

-- ---------------------------------------------------------------------------
-- Tab settlement: allocate payments to unpaid tab orders, oldest first.
-- ---------------------------------------------------------------------------
create or replace function public.tab_settle(
  p_tab uuid, p_payments jsonb, p_idempotency_key uuid,
  p_close boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tab public.tabs%rowtype;
  v_shift public.shifts%rowtype;
  v_pay jsonb;
  v_method public.payment_methods%rowtype;
  v_pay_total numeric := 0;
  v_outstanding numeric;
  v_alloc numeric;
  v_remaining numeric;
  v_tendered numeric;
  v_change numeric;
  o record;
begin
  if not public.has_permission('tabs.manage') then
    raise exception 'permission denied: tabs.manage';
  end if;
  if exists (select 1 from public.payments where idempotency_key = p_idempotency_key) then
    return jsonb_build_object('replayed', true);
  end if;

  select * into v_tab from public.tabs where id = p_tab for update;
  if not found then raise exception 'unknown tab'; end if;
  if v_tab.status <> 'open' then raise exception 'tab is closed'; end if;

  select * into v_shift from public.shifts
   where cashier_id = auth.uid() and status = 'open';
  if not found then raise exception 'open a shift before taking payments'; end if;

  select coalesce(sum(total - amount_paid), 0) into v_outstanding
  from public.orders
  where tab_id = p_tab and status = 'completed' and payment_status <> 'paid';

  for v_pay in select * from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    v_pay_total := v_pay_total + (v_pay ->> 'amount')::numeric;
  end loop;
  if v_pay_total <= 0 then raise exception 'no payment provided'; end if;
  if round(v_pay_total, 2) > round(v_outstanding, 2) then
    raise exception 'payment (%) exceeds the tab balance (%)', v_pay_total, v_outstanding;
  end if;

  -- Record payments (first payment row carries the idempotency key).
  declare v_first boolean := true;
  begin
    for v_pay in select * from jsonb_array_elements(p_payments) loop
      select * into v_method from public.payment_methods
       where code = v_pay ->> 'method' and is_active;
      if not found then raise exception 'unknown payment method %', v_pay ->> 'method'; end if;
      if v_method.requires_reference and coalesce(btrim(v_pay ->> 'reference_no'), '') = '' then
        raise exception '% payments need a reference number', v_method.name;
      end if;
      v_tendered := nullif(v_pay ->> 'tendered', '')::numeric;
      v_change := case when v_tendered is not null
        then round(v_tendered - (v_pay ->> 'amount')::numeric, 2) end;
      if v_change is not null and v_change < 0 then
        raise exception 'tendered cash is less than the amount due';
      end if;
      insert into public.payments
        (tab_id, method_id, amount, reference_no, tendered, change, cashier_id, shift_id,
         idempotency_key)
      values (p_tab, v_method.id, (v_pay ->> 'amount')::numeric,
        nullif(v_pay ->> 'reference_no', ''), v_tendered, v_change, auth.uid(), v_shift.id,
        case when v_first then p_idempotency_key end);
      v_first := false;
    end loop;
  end;

  -- Allocate to orders FIFO.
  v_remaining := v_pay_total;
  for o in
    select id, total, amount_paid from public.orders
    where tab_id = p_tab and status = 'completed' and payment_status <> 'paid'
    order by created_at
    for update
  loop
    exit when v_remaining <= 0;
    v_alloc := least(v_remaining, o.total - o.amount_paid);
    update public.orders set
      amount_paid = amount_paid + v_alloc,
      payment_status = case when amount_paid + v_alloc >= total then 'paid' else 'partial' end
    where id = o.id;
    v_remaining := v_remaining - v_alloc;
  end loop;

  if p_close then
    if round(v_pay_total, 2) < round(v_outstanding, 2) then
      raise exception 'cannot close a tab with an unpaid balance';
    end if;
    update public.tabs set status = 'closed', closed_by = auth.uid(), closed_at = now()
    where id = p_tab;
  end if;

  perform public.log_audit('tab.settle', 'tabs', p_tab::text, null,
    jsonb_build_object('amount', v_pay_total, 'closed', p_close));

  return jsonb_build_object('paid', v_pay_total,
    'outstanding', round(v_outstanding - v_pay_total, 2),
    'closed', p_close);
end $$;

-- Reopen a closed tab (manager authorization).
create or replace function public.tab_reopen(p_tab uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('tabs.reopen') then
    raise exception 'permission denied: tabs.reopen';
  end if;
  update public.tabs set status = 'open', closed_by = null, closed_at = null
  where id = p_tab and status = 'closed';
  if not found then raise exception 'tab is not closed'; end if;
  perform public.log_audit('tab.reopen', 'tabs', p_tab::text, null, null, p_reason);
end $$;

-- Cancel an open/held (unpaid, un-posted) order.
create or replace function public.order_cancel(p_order uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare v public.orders%rowtype;
begin
  if not public.has_permission('pos.sell') then
    raise exception 'permission denied: pos.sell';
  end if;
  select * into v from public.orders where id = p_order for update;
  if not found then raise exception 'unknown order'; end if;
  if v.status not in ('open', 'held') then
    raise exception 'only open or held orders can be cancelled (use void for completed sales)';
  end if;
  update public.orders set status = 'cancelled', void_reason = p_reason where id = p_order;
  perform public.log_audit('order.cancel', 'orders', p_order::text, null, null, p_reason);
end $$;

-- ---------------------------------------------------------------------------
-- Grants & RLS
-- ---------------------------------------------------------------------------
grant select on public.payment_methods, public.customers, public.tabs,
  public.orders, public.order_items, public.order_item_modifiers,
  public.order_discounts, public.payments, public.shifts to authenticated;
grant insert, update on public.customers to authenticated;
grant update (prep_status, prep_status_at) on public.order_items to authenticated;
grant all on public.payment_methods, public.customers, public.tabs, public.orders,
  public.order_items, public.order_item_modifiers, public.order_discounts,
  public.payments, public.shifts to service_role;

alter table public.payment_methods enable row level security;
alter table public.customers enable row level security;
alter table public.tabs enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_item_modifiers enable row level security;
alter table public.order_discounts enable row level security;
alter table public.payments enable row level security;
alter table public.shifts enable row level security;

create policy payment_methods_select on public.payment_methods for select
  to authenticated using (public.is_active_staff());

-- Cashiers see basic customer info; management sees the same rows (field-level
-- separation is handled in the UI; spend history needs reports permissions).
create policy customers_select on public.customers for select
  to authenticated using (public.has_permission('customers.view.basic'));
create policy customers_insert on public.customers for insert
  to authenticated with check (public.has_permission('customers.view.basic'));
create policy customers_update on public.customers for update
  to authenticated using (public.has_permission('customers.manage'));

create policy tabs_select on public.tabs for select
  to authenticated using (public.has_permission('orders.view') or public.has_permission('tabs.manage'));
create policy orders_select on public.orders for select
  to authenticated using (public.has_permission('orders.view') or public.has_permission('kds.view'));
create policy order_items_select on public.order_items for select
  to authenticated using (public.has_permission('orders.view') or public.has_permission('kds.view'));
create policy order_item_modifiers_select on public.order_item_modifiers for select
  to authenticated using (public.has_permission('orders.view') or public.has_permission('kds.view'));
create policy order_discounts_select on public.order_discounts for select
  to authenticated using (public.has_permission('orders.view'));
create policy payments_select on public.payments for select
  to authenticated using (
    public.has_permission('reports.sales')
    or (public.has_permission('shifts.own') and cashier_id = auth.uid())
  );
create policy shifts_select on public.shifts for select
  to authenticated using (
    public.has_permission('shifts.manage') or cashier_id = auth.uid()
  );

-- KDS staff may update prep status only (column grant above restricts columns).
create policy order_items_prep_update on public.order_items for update
  to authenticated using (public.has_permission('kds.update') or public.has_permission('pos.sell'))
  with check (public.has_permission('kds.update') or public.has_permission('pos.sell'));

-- All writes to orders/payments/tabs go through the definer RPCs.
grant execute on function
  public.shift_open(numeric, text, text),
  public.pos_checkout(jsonb, uuid),
  public.tab_settle(uuid, jsonb, uuid, boolean),
  public.tab_reopen(uuid, text),
  public.order_cancel(uuid, text)
to authenticated;
