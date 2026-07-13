-- 0007 Operational controls: cash drawer movements, shift close with
-- reconciliation, waste workflow with approval, stock counts, production
-- batches, refunds and voids.

-- ---------------------------------------------------------------------------
-- Cash drawer movements
-- ---------------------------------------------------------------------------
create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts (id),
  kind text not null check (kind in ('paid_in', 'paid_out')),
  amount numeric(12,2) not null check (amount > 0),
  reason text not null,
  notes text,
  user_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);
create index cash_movements_shift_idx on public.cash_movements (shift_id);

create or replace function public.cash_move(
  p_kind text, p_amount numeric, p_reason text, p_notes text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_shift uuid;
begin
  if not public.has_permission('shifts.own') then
    raise exception 'permission denied: shifts.own';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required for cash movements';
  end if;
  select id into v_shift from public.shifts
   where cashier_id = auth.uid() and status = 'open';
  if not found then raise exception 'no open shift'; end if;
  insert into public.cash_movements (shift_id, kind, amount, reason, notes, user_id)
  values (v_shift, p_kind, p_amount, p_reason, p_notes, auth.uid());
  perform public.log_audit('cash.' || p_kind, 'shifts', v_shift::text, null,
    jsonb_build_object('amount', p_amount), p_reason);
end $$;

-- ---------------------------------------------------------------------------
-- Refunds (money returned after payment) and voids (reverse a completed sale)
-- ---------------------------------------------------------------------------
create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  refund_number text not null unique,
  order_id uuid not null references public.orders (id),
  amount numeric(12,2) not null check (amount > 0),
  method_id uuid not null references public.payment_methods (id),
  reason text not null,
  restocked boolean not null default false,
  refunded_by uuid not null references public.profiles (id),
  shift_id uuid references public.shifts (id),
  idempotency_key uuid unique,
  created_at timestamptz not null default now()
);

alter table public.orders add column refund_total numeric(12,2) not null default 0;

-- Reverse the inventory an order consumed (used by void and restocking refunds).
-- Adds stock back batch-less at the consumed cost via void_reversal movements.
create or replace function public.order_restock(p_order uuid, p_movement public.movement_type)
returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select item_id, sum(-qty) as qty_consumed,
           case when sum(-qty) > 0 then sum(-qty * unit_cost) / sum(-qty) else 0 end as unit_cost
    from public.inventory_movements
    where ref_type = 'order' and ref_id = p_order::text and qty < 0
    group by item_id
    having sum(-qty) > 0
  loop
    perform public.add_stock(r.item_id, r.qty_consumed, round(r.unit_cost, 6),
      p_movement, 'order_reversal', p_order::text);
  end loop;
end $$;

create or replace function public.order_void(p_order uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare v public.orders%rowtype;
begin
  if not public.has_permission('pos.void') then
    raise exception 'permission denied: pos.void';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required to void a sale';
  end if;
  select * into v from public.orders where id = p_order for update;
  if not found then raise exception 'unknown order'; end if;
  if v.status <> 'completed' then raise exception 'only completed sales can be voided'; end if;
  if v.refund_total > 0 then raise exception 'order already has refunds — void is not allowed'; end if;

  update public.payments set status = 'voided' where order_id = p_order and status = 'posted';
  perform public.order_restock(p_order, 'void_reversal');
  update public.orders set
    status = 'voided', voided_at = now(), void_reason = p_reason
  where id = p_order;

  perform public.log_audit('order.void', 'orders', p_order::text,
    jsonb_build_object('total', v.total, 'amount_paid', v.amount_paid), null, p_reason);
end $$;

create or replace function public.order_refund(
  p_order uuid, p_amount numeric, p_method text, p_reason text,
  p_restock boolean, p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v public.orders%rowtype;
  v_method public.payment_methods%rowtype;
  v_shift uuid;
  v_number text;
  v_id uuid;
begin
  if not public.has_permission('pos.refund') then
    raise exception 'permission denied: pos.refund';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required for refunds';
  end if;
  if exists (select 1 from public.refunds where idempotency_key = p_idempotency_key) then
    return jsonb_build_object('replayed', true);
  end if;

  select * into v from public.orders where id = p_order for update;
  if not found then raise exception 'unknown order'; end if;
  if v.status <> 'completed' then raise exception 'only completed sales can be refunded'; end if;
  if p_amount <= 0 or p_amount > v.amount_paid - v.refund_total then
    raise exception 'refund exceeds the refundable amount (%)', v.amount_paid - v.refund_total;
  end if;

  select * into v_method from public.payment_methods where code = p_method and is_active;
  if not found then raise exception 'unknown refund method %', p_method; end if;

  select id into v_shift from public.shifts
   where cashier_id = auth.uid() and status = 'open';

  v_number := public.next_doc_number('refund');
  insert into public.refunds
    (refund_number, order_id, amount, method_id, reason, restocked, refunded_by,
     shift_id, idempotency_key)
  values (v_number, p_order, p_amount, v_method.id, p_reason, p_restock,
          auth.uid(), v_shift, p_idempotency_key)
  returning id into v_id;

  update public.orders set refund_total = refund_total + p_amount where id = p_order;

  if p_restock then
    perform public.order_restock(p_order, 'refund_return');
  end if;

  perform public.log_audit('order.refund', 'orders', p_order::text, null,
    jsonb_build_object('refund', v_number, 'amount', p_amount, 'restocked', p_restock),
    p_reason);

  return jsonb_build_object('refund_id', v_id, 'refund_number', v_number);
end $$;

-- ---------------------------------------------------------------------------
-- Shift close with reconciliation
-- ---------------------------------------------------------------------------
create or replace function public.shift_expected_cash(p_shift uuid)
returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_shift public.shifts%rowtype;
  v_cash_sales numeric;
  v_cash_refunds numeric;
  v_in numeric;
  v_out numeric;
begin
  select * into v_shift from public.shifts where id = p_shift;
  if not found then raise exception 'unknown shift'; end if;
  -- Only the shift owner (post-close or with the blind-count setting off),
  -- or holders of shifts.view_expected_cash, may see the expected amount.
  if not (
    public.has_permission('shifts.view_expected_cash')
    or (v_shift.cashier_id = auth.uid() and (
      v_shift.status = 'closed'
      or coalesce((public.get_setting('shifts') ->> 'show_expected_cash_before_count')::boolean, false)
    ))
  ) then
    raise exception 'expected cash is hidden until the drawer is counted';
  end if;

  select coalesce(sum(p.amount), 0) into v_cash_sales
  from public.payments p
  join public.payment_methods m on m.id = p.method_id
  where p.shift_id = p_shift and p.status = 'posted' and m.kind = 'cash';

  select coalesce(sum(r.amount), 0) into v_cash_refunds
  from public.refunds r
  join public.payment_methods m on m.id = r.method_id
  where r.shift_id = p_shift and m.kind = 'cash';

  select coalesce(sum(amount) filter (where kind = 'paid_in'), 0),
         coalesce(sum(amount) filter (where kind = 'paid_out'), 0)
    into v_in, v_out
  from public.cash_movements where shift_id = p_shift;

  return v_shift.opening_cash + v_cash_sales - v_cash_refunds + v_in - v_out;
end $$;

create or replace function public.shift_close(
  p_actual_cash numeric, p_variance_reason text default null, p_notes text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_shift public.shifts%rowtype;
  v_expected numeric;
  v_variance numeric;
  v_totals jsonb;
begin
  if not public.has_permission('shifts.own') then
    raise exception 'permission denied: shifts.own';
  end if;
  if p_actual_cash < 0 then raise exception 'actual cash cannot be negative'; end if;

  select * into v_shift from public.shifts
   where cashier_id = auth.uid() and status = 'open' for update;
  if not found then raise exception 'no open shift'; end if;

  -- Direct computation (bypasses the visibility gate — the shift is closing now).
  select v_shift.opening_cash
    + coalesce((select sum(p.amount) from public.payments p
        join public.payment_methods m on m.id = p.method_id
        where p.shift_id = v_shift.id and p.status = 'posted' and m.kind = 'cash'), 0)
    - coalesce((select sum(r.amount) from public.refunds r
        join public.payment_methods m on m.id = r.method_id
        where r.shift_id = v_shift.id and m.kind = 'cash'), 0)
    + coalesce((select sum(amount) from public.cash_movements
        where shift_id = v_shift.id and kind = 'paid_in'), 0)
    - coalesce((select sum(amount) from public.cash_movements
        where shift_id = v_shift.id and kind = 'paid_out'), 0)
  into v_expected;

  v_variance := round(p_actual_cash - v_expected, 2);
  if v_variance <> 0 and coalesce(btrim(p_variance_reason), '') = '' then
    raise exception 'a reason is required for the cash variance of %', v_variance;
  end if;

  -- Snapshot of the shift's activity for the printable report.
  select jsonb_build_object(
    'by_method', coalesce((
      select jsonb_object_agg(m.name, s.amt) from (
        select p.method_id, sum(p.amount) as amt
        from public.payments p
        where p.shift_id = v_shift.id and p.status = 'posted'
        group by p.method_id) s
      join public.payment_methods m on m.id = s.method_id), '{}'::jsonb),
    'orders', (select count(*) from public.orders
               where shift_id = v_shift.id and status = 'completed'),
    'voids', (select count(*) from public.orders
              where shift_id = v_shift.id and status = 'voided'),
    'refunds', coalesce((select sum(amount) from public.refunds
                         where shift_id = v_shift.id), 0),
    'discounts', coalesce((select sum(discount_total) from public.orders
                           where shift_id = v_shift.id and status = 'completed'), 0),
    'gross_sales', coalesce((select sum(total) from public.orders
                             where shift_id = v_shift.id and status = 'completed'), 0),
    'paid_in', coalesce((select sum(amount) from public.cash_movements
                         where shift_id = v_shift.id and kind = 'paid_in'), 0),
    'paid_out', coalesce((select sum(amount) from public.cash_movements
                          where shift_id = v_shift.id and kind = 'paid_out'), 0)
  ) into v_totals;

  update public.shifts set
    status = 'closed', closed_at = now(),
    expected_cash = v_expected, actual_cash = p_actual_cash,
    variance = v_variance, variance_reason = nullif(btrim(coalesce(p_variance_reason, '')), ''),
    totals_snapshot = v_totals, notes = coalesce(p_notes, notes)
  where id = v_shift.id;

  perform public.log_audit('shift.close', 'shifts', v_shift.id::text, null,
    jsonb_build_object('expected', v_expected, 'actual', p_actual_cash,
                       'variance', v_variance), p_variance_reason);

  return jsonb_build_object('shift_id', v_shift.id, 'expected_cash', v_expected,
    'actual_cash', p_actual_cash, 'variance', v_variance, 'totals', v_totals);
end $$;

-- ---------------------------------------------------------------------------
-- Waste / spoilage / staff meals / complimentary
-- ---------------------------------------------------------------------------
create table public.waste_records (
  id uuid primary key default gen_random_uuid(),
  waste_number text not null unique,
  -- either a stock item OR a prepared product (deducts its recipe)
  item_id uuid references public.inventory_items (id),
  product_id uuid references public.products (id),
  variant_id uuid references public.product_variants (id),
  qty numeric(14,4) not null check (qty > 0),
  reason_code text not null check (reason_code in
    ('expired', 'spoiled', 'spilled', 'burnt', 'wrong_preparation', 'damaged',
     'staff_meal', 'complimentary', 'sampling', 'missing', 'other')),
  notes text,
  station public.prep_station,
  photo_url text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  cost numeric(12,2),
  reported_by uuid not null references public.profiles (id),
  approved_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint waste_target check ((item_id is null) <> (product_id is null))
);

create or replace function public.waste_post_internal(p_waste uuid)
returns numeric
language plpgsql security definer set search_path = public as $$
declare
  w public.waste_records%rowtype;
  v_cost numeric := 0;
  v_movement public.movement_type;
  line record;
begin
  select * into w from public.waste_records where id = p_waste for update;
  v_movement := case w.reason_code
    when 'expired' then 'spoilage'
    when 'spoiled' then 'spoilage'
    when 'staff_meal' then 'staff_meal'
    when 'complimentary' then 'complimentary'
    when 'sampling' then 'complimentary'
    else 'waste' end;

  if w.item_id is not null then
    v_cost := public.consume_stock(w.item_id, w.qty, v_movement,
      'waste', w.id::text, w.reason_code, w.notes, true, true);
  else
    for line in
      select ri.item_id, ri.qty, ri.waste_pct
      from public.recipe_ingredients ri
      where ri.product_id = w.product_id
        and (ri.variant_id is null or ri.variant_id = w.variant_id)
    loop
      v_cost := v_cost + public.consume_stock(line.item_id,
        round(line.qty * w.qty, 4), v_movement,
        'waste', w.id::text, w.reason_code, w.notes, true, true);
    end loop;
  end if;
  return round(v_cost, 2);
end $$;

create or replace function public.waste_report(
  p_item uuid, p_product uuid, p_variant uuid, p_qty numeric,
  p_reason_code text, p_notes text default null,
  p_station public.prep_station default null, p_photo_url text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_number text; v_auto boolean; v_cost numeric;
begin
  if not public.has_permission('inventory.waste') then
    raise exception 'permission denied: inventory.waste';
  end if;
  v_number := public.next_doc_number('waste');
  insert into public.waste_records
    (waste_number, item_id, product_id, variant_id, qty, reason_code, notes,
     station, photo_url, reported_by)
  values (v_number, p_item, p_product, p_variant, p_qty, p_reason_code, p_notes,
          p_station, p_photo_url, auth.uid())
  returning id into v_id;

  -- Approvers post immediately; others wait for approval.
  v_auto := public.has_permission('inventory.waste.approve');
  if v_auto then
    v_cost := public.waste_post_internal(v_id);
    update public.waste_records set
      status = 'approved', approved_by = auth.uid(), cost = v_cost, resolved_at = now()
    where id = v_id;
  end if;

  perform public.log_audit('waste.report', 'waste_records', v_id::text, null,
    jsonb_build_object('number', v_number, 'qty', p_qty, 'reason', p_reason_code,
                       'auto_approved', v_auto));
  return jsonb_build_object('waste_id', v_id, 'waste_number', v_number,
    'status', case when v_auto then 'approved' else 'pending' end);
end $$;

create or replace function public.waste_resolve(p_waste uuid, p_approve boolean, p_notes text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare w public.waste_records%rowtype; v_cost numeric;
begin
  if not public.has_permission('inventory.waste.approve') then
    raise exception 'permission denied: inventory.waste.approve';
  end if;
  select * into w from public.waste_records where id = p_waste for update;
  if not found then raise exception 'unknown waste record'; end if;
  if w.status <> 'pending' then raise exception 'waste record already resolved'; end if;

  if p_approve then
    v_cost := public.waste_post_internal(p_waste);
    update public.waste_records set
      status = 'approved', approved_by = auth.uid(), cost = v_cost,
      resolved_at = now(), notes = coalesce(p_notes, notes)
    where id = p_waste;
  else
    update public.waste_records set
      status = 'rejected', approved_by = auth.uid(), resolved_at = now(),
      notes = coalesce(p_notes, notes)
    where id = p_waste;
  end if;
  perform public.log_audit('waste.' || case when p_approve then 'approve' else 'reject' end,
    'waste_records', p_waste::text, null, null, p_notes);
end $$;

-- ---------------------------------------------------------------------------
-- Stock counts
-- ---------------------------------------------------------------------------
create table public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  sc_number text not null unique,
  status text not null default 'draft' check (status in
    ('draft', 'submitted', 'posted', 'cancelled')),
  notes text,
  started_by uuid not null references public.profiles (id),
  approved_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  posted_at timestamptz
);

create table public.stock_count_items (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references public.stock_counts (id) on delete cascade,
  item_id uuid not null references public.inventory_items (id),
  expected_qty numeric(14,4) not null,
  actual_qty numeric(14,4),
  note text,
  unique (count_id, item_id)
);

create or replace function public.count_start(p_item_ids uuid[] default null, p_notes text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.has_permission('inventory.count') then
    raise exception 'permission denied: inventory.count';
  end if;
  insert into public.stock_counts (sc_number, notes, started_by)
  values (public.next_doc_number('stock_count'), p_notes, auth.uid())
  returning id into v_id;

  insert into public.stock_count_items (count_id, item_id, expected_qty)
  select v_id, i.id, i.current_stock
  from public.inventory_items i
  where i.archived_at is null
    and (p_item_ids is null or i.id = any (p_item_ids));

  return v_id;
end $$;

create or replace function public.count_submit(p_count uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('inventory.count') then
    raise exception 'permission denied: inventory.count';
  end if;
  update public.stock_counts set status = 'submitted'
  where id = p_count and status = 'draft';
  if not found then raise exception 'count is not a draft'; end if;
  if exists (select 1 from public.stock_count_items
             where count_id = p_count and actual_qty is null) then
    raise exception 'enter an actual quantity for every line before submitting';
  end if;
  perform public.log_audit('count.submit', 'stock_counts', p_count::text);
end $$;

-- Approve + post variances to the ledger (variance vs live stock at posting).
create or replace function public.count_post(p_count uuid, p_approve boolean, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c public.stock_counts%rowtype;
  line record;
  v_delta numeric;
  v_posted int := 0;
begin
  if not public.has_permission('inventory.waste.approve') then
    raise exception 'permission denied: stock counts need approval permission';
  end if;
  select * into c from public.stock_counts where id = p_count for update;
  if not found then raise exception 'unknown count'; end if;
  if c.status <> 'submitted' then raise exception 'count is not awaiting approval'; end if;

  if not p_approve then
    update public.stock_counts set status = 'cancelled', approved_by = auth.uid()
    where id = p_count;
    perform public.log_audit('count.reject', 'stock_counts', p_count::text, null, null, p_reason);
    return jsonb_build_object('posted', 0, 'status', 'cancelled');
  end if;

  for line in
    select sci.item_id, sci.actual_qty, sci.note, i.current_stock
    from public.stock_count_items sci
    join public.inventory_items i on i.id = sci.item_id
    where sci.count_id = p_count
  loop
    v_delta := line.actual_qty - line.current_stock;
    if v_delta <> 0 then
      if v_delta > 0 then
        perform public.add_stock(line.item_id, v_delta,
          (select coalesce(nullif(avg_cost, 0), latest_cost) from public.inventory_items where id = line.item_id),
          'count_adjust', 'stock_count', p_count::text, null, null, line.note);
      else
        perform public.consume_stock(line.item_id, -v_delta, 'count_adjust',
          'stock_count', p_count::text,
          coalesce(p_reason, 'physical count variance'), line.note, true, true);
      end if;
      v_posted := v_posted + 1;
    end if;
  end loop;

  update public.stock_counts set
    status = 'posted', approved_by = auth.uid(), posted_at = now()
  where id = p_count;
  perform public.log_audit('count.post', 'stock_counts', p_count::text, null,
    jsonb_build_object('adjusted_items', v_posted), p_reason);

  return jsonb_build_object('posted', v_posted, 'status', 'posted');
end $$;

-- ---------------------------------------------------------------------------
-- Production batches (cold brew, syrups, cooked rice…)
-- ---------------------------------------------------------------------------
create table public.production_batches (
  id uuid primary key default gen_random_uuid(),
  pb_number text not null unique,
  output_item_id uuid not null references public.inventory_items (id),
  qty_produced numeric(14,4) not null check (qty_produced > 0),
  waste_qty numeric(14,4) not null default 0 check (waste_qty >= 0),
  unit_cost numeric(14,6) not null default 0,
  expires_at date,
  notes text,
  produced_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.production_inputs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.production_batches (id) on delete cascade,
  item_id uuid not null references public.inventory_items (id),
  qty numeric(14,4) not null check (qty > 0),
  cost numeric(12,2) not null default 0
);

create or replace function public.production_post(
  p_output_item uuid, p_qty numeric, p_inputs jsonb,
  p_expires date default null, p_waste_qty numeric default 0, p_notes text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_number text;
  v_line jsonb;
  v_cost numeric := 0;
  v_line_cost numeric;
  v_unit_cost numeric;
begin
  if not public.has_permission('inventory.produce') then
    raise exception 'permission denied: inventory.produce';
  end if;
  if p_qty <= 0 then raise exception 'production quantity must be positive'; end if;
  if jsonb_array_length(coalesce(p_inputs, '[]'::jsonb)) = 0 then
    raise exception 'production needs at least one input';
  end if;

  v_number := public.next_doc_number('production');
  insert into public.production_batches
    (pb_number, output_item_id, qty_produced, waste_qty, expires_at, notes, produced_by)
  values (v_number, p_output_item, p_qty, coalesce(p_waste_qty, 0), p_expires, p_notes, auth.uid())
  returning id into v_id;

  for v_line in select * from jsonb_array_elements(p_inputs) loop
    v_line_cost := public.consume_stock(
      (v_line ->> 'item_id')::uuid, (v_line ->> 'qty')::numeric,
      'production_consume', 'production', v_id::text);
    insert into public.production_inputs (batch_id, item_id, qty, cost)
    values (v_id, (v_line ->> 'item_id')::uuid, (v_line ->> 'qty')::numeric,
            round(v_line_cost, 2));
    v_cost := v_cost + v_line_cost;
  end loop;

  -- Whole batch cost lands on the good output units (waste absorbs no cost
  -- reduction — it is part of the production cost).
  v_unit_cost := round(v_cost / p_qty, 6);
  perform public.add_stock(p_output_item, p_qty, v_unit_cost, 'production_in',
    'production', v_id::text, p_expires);

  update public.production_batches set unit_cost = v_unit_cost where id = v_id;
  perform public.log_audit('production.post', 'production_batches', v_id::text, null,
    jsonb_build_object('number', v_number, 'qty', p_qty, 'unit_cost', v_unit_cost));

  return jsonb_build_object('batch_id', v_id, 'batch_number', v_number,
    'unit_cost', v_unit_cost);
end $$;

-- ---------------------------------------------------------------------------
-- Grants & RLS
-- ---------------------------------------------------------------------------
grant select on public.cash_movements, public.refunds, public.waste_records,
  public.stock_counts, public.stock_count_items, public.production_batches,
  public.production_inputs to authenticated;
grant update (actual_qty, note) on public.stock_count_items to authenticated;
grant all on public.cash_movements, public.refunds, public.waste_records,
  public.stock_counts, public.stock_count_items, public.production_batches,
  public.production_inputs to service_role;

alter table public.cash_movements enable row level security;
alter table public.refunds enable row level security;
alter table public.waste_records enable row level security;
alter table public.stock_counts enable row level security;
alter table public.stock_count_items enable row level security;
alter table public.production_batches enable row level security;
alter table public.production_inputs enable row level security;

create policy cash_movements_select on public.cash_movements for select
  to authenticated using (
    public.has_permission('shifts.manage')
    or exists (select 1 from public.shifts s
               where s.id = shift_id and s.cashier_id = auth.uid())
  );
create policy refunds_select on public.refunds for select
  to authenticated using (
    public.has_permission('reports.sales') or refunded_by = auth.uid()
  );
create policy waste_select on public.waste_records for select
  to authenticated using (
    public.has_permission('inventory.view') or public.has_permission('inventory.waste')
  );
create policy counts_select on public.stock_counts for select
  to authenticated using (public.has_permission('inventory.count')
    or public.has_permission('inventory.view'));
create policy count_items_select on public.stock_count_items for select
  to authenticated using (public.has_permission('inventory.count')
    or public.has_permission('inventory.view'));
create policy count_items_update on public.stock_count_items for update
  to authenticated using (
    public.has_permission('inventory.count')
    and exists (select 1 from public.stock_counts c
                where c.id = count_id and c.status = 'draft')
  );
create policy production_select on public.production_batches for select
  to authenticated using (public.has_permission('inventory.view')
    or public.has_permission('inventory.produce'));
create policy production_inputs_select on public.production_inputs for select
  to authenticated using (public.has_permission('inventory.view')
    or public.has_permission('inventory.produce'));

grant execute on function
  public.cash_move(text, numeric, text, text),
  public.order_void(uuid, text),
  public.order_refund(uuid, numeric, text, text, boolean, uuid),
  public.shift_expected_cash(uuid),
  public.shift_close(numeric, text, text),
  public.waste_report(uuid, uuid, uuid, numeric, text, text, public.prep_station, text),
  public.waste_resolve(uuid, boolean, text),
  public.count_start(uuid[], text),
  public.count_submit(uuid),
  public.count_post(uuid, boolean, text),
  public.production_post(uuid, numeric, jsonb, date, numeric, text)
to authenticated;
