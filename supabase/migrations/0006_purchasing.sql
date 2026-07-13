-- 0006 Purchasing: suppliers, purchase orders, receiving (partial, rejected,
-- landed costs), supplier payments and payable balances.

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  contact_person text not null default '',
  phone text not null default '',
  email text not null default '',
  address text not null default '',
  payment_terms_days int not null default 0 check (payment_terms_days >= 0),
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger suppliers_updated_at before update on public.suppliers
  for each row execute function public.set_updated_at();

alter table public.inventory_items
  add constraint inventory_items_supplier_fkey
  foreign key (default_supplier_id) references public.suppliers (id);
alter table public.inventory_batches
  add constraint inventory_batches_supplier_fkey
  foreign key (supplier_id) references public.suppliers (id);

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text not null unique,
  supplier_id uuid not null references public.suppliers (id),
  status text not null default 'draft' check (status in
    ('draft', 'sent', 'partially_received', 'received', 'cancelled', 'closed')),
  order_date date not null default current_date,
  expected_date date,
  discount numeric(12,2) not null default 0 check (discount >= 0),
  tax numeric(12,2) not null default 0 check (tax >= 0),
  shipping numeric(12,2) not null default 0 check (shipping >= 0),
  supplier_invoice_no text,
  notes text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger purchase_orders_updated_at before update on public.purchase_orders
  for each row execute function public.set_updated_at();
create index purchase_orders_supplier_idx on public.purchase_orders (supplier_id);

-- Quantities and costs are in the item's PURCHASE unit (e.g. "case of 24");
-- receiving converts to base units via purchase_to_base_factor.
create table public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders (id) on delete cascade,
  item_id uuid not null references public.inventory_items (id),
  qty_ordered numeric(14,4) not null check (qty_ordered > 0),
  qty_received numeric(14,4) not null default 0 check (qty_received >= 0),
  qty_rejected numeric(14,4) not null default 0 check (qty_rejected >= 0),
  unit_cost numeric(14,6) not null check (unit_cost >= 0),
  created_at timestamptz not null default now()
);
create index po_items_po_idx on public.purchase_order_items (po_id);

create table public.goods_receipts (
  id uuid primary key default gen_random_uuid(),
  gr_number text not null unique,
  po_id uuid not null references public.purchase_orders (id),
  landed_cost numeric(12,2) not null default 0 check (landed_cost >= 0),
  notes text,
  received_by uuid not null references public.profiles (id),
  received_at timestamptz not null default now()
);

create table public.goods_receipt_items (
  id uuid primary key default gen_random_uuid(),
  gr_id uuid not null references public.goods_receipts (id) on delete cascade,
  po_item_id uuid not null references public.purchase_order_items (id),
  qty_received numeric(14,4) not null check (qty_received >= 0),
  qty_rejected numeric(14,4) not null default 0 check (qty_rejected >= 0),
  unit_cost numeric(14,6) not null check (unit_cost >= 0),
  expires_at date
);

create table public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id),
  po_id uuid references public.purchase_orders (id),
  amount numeric(12,2) not null check (amount > 0),
  method text not null default 'cash',
  reference_no text,
  notes text,
  paid_at date not null default current_date,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);
create index supplier_payments_supplier_idx on public.supplier_payments (supplier_id);

-- ---------------------------------------------------------------------------
-- Receive a purchase order (fully or partially) in one transaction.
-- p_items: [{po_item_id, qty_received, qty_rejected, unit_cost, expires_at}]
-- Landed cost is allocated across received lines proportionally to value and
-- baked into the batch unit cost.
-- ---------------------------------------------------------------------------
create or replace function public.po_receive(
  p_po uuid, p_items jsonb, p_landed_cost numeric default 0,
  p_invoice_no text default null, p_notes text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_po public.purchase_orders%rowtype;
  v_gr_id uuid;
  v_gr_number text;
  v_line jsonb;
  v_po_item public.purchase_order_items%rowtype;
  v_item public.inventory_items%rowtype;
  v_received_value numeric := 0;
  v_qty numeric;
  v_rej numeric;
  v_cost numeric;
  v_base_qty numeric;
  v_base_cost numeric;
  v_alloc numeric;
  v_all_received boolean;
begin
  if not public.has_permission('inventory.receive') then
    raise exception 'permission denied: inventory.receive';
  end if;
  if coalesce(p_landed_cost, 0) < 0 then
    raise exception 'landed cost cannot be negative';
  end if;

  select * into v_po from public.purchase_orders where id = p_po for update;
  if not found then raise exception 'unknown purchase order'; end if;
  if v_po.status not in ('sent', 'partially_received') then
    raise exception 'purchase order is % — only sent orders can be received', v_po.status;
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'nothing to receive';
  end if;

  -- Total received value for landed-cost allocation.
  for v_line in select * from jsonb_array_elements(p_items) loop
    v_received_value := v_received_value +
      coalesce((v_line ->> 'qty_received')::numeric, 0)
      * coalesce((v_line ->> 'unit_cost')::numeric, 0);
  end loop;

  v_gr_number := public.next_doc_number('goods_receipt');
  insert into public.goods_receipts (gr_number, po_id, landed_cost, notes, received_by)
  values (v_gr_number, p_po, coalesce(p_landed_cost, 0), p_notes, auth.uid())
  returning id into v_gr_id;

  for v_line in select * from jsonb_array_elements(p_items) loop
    select * into v_po_item from public.purchase_order_items
     where id = (v_line ->> 'po_item_id')::uuid and po_id = p_po for update;
    if not found then raise exception 'line does not belong to this purchase order'; end if;

    v_qty := coalesce((v_line ->> 'qty_received')::numeric, 0);
    v_rej := coalesce((v_line ->> 'qty_rejected')::numeric, 0);
    v_cost := coalesce((v_line ->> 'unit_cost')::numeric, v_po_item.unit_cost);
    if v_qty < 0 or v_rej < 0 then raise exception 'negative receive quantities'; end if;
    if v_qty = 0 and v_rej = 0 then continue; end if;
    if v_po_item.qty_received + v_po_item.qty_rejected + v_qty + v_rej
       > v_po_item.qty_ordered then
      raise exception 'receiving more than ordered for line %', v_po_item.id;
    end if;

    insert into public.goods_receipt_items
      (gr_id, po_item_id, qty_received, qty_rejected, unit_cost, expires_at)
    values (v_gr_id, v_po_item.id, v_qty, v_rej, v_cost,
            nullif(v_line ->> 'expires_at', '')::date);

    update public.purchase_order_items
       set qty_received = qty_received + v_qty,
           qty_rejected = qty_rejected + v_rej
     where id = v_po_item.id;

    if v_qty > 0 then
      select * into v_item from public.inventory_items where id = v_po_item.item_id;
      -- landed cost share proportional to line value
      v_alloc := case when v_received_value > 0
        then coalesce(p_landed_cost, 0) * (v_qty * v_cost) / v_received_value
        else 0 end;
      v_base_qty := round(v_qty * v_item.purchase_to_base_factor, 4);
      v_base_cost := round((v_qty * v_cost + v_alloc) / v_base_qty, 6);
      perform public.add_stock(
        v_po_item.item_id, v_base_qty, v_base_cost, 'purchase_receipt',
        'goods_receipt', v_gr_id::text,
        nullif(v_line ->> 'expires_at', '')::date, v_po.supplier_id, p_notes);
    end if;
  end loop;

  -- PO status
  select bool_and(qty_received + qty_rejected >= qty_ordered)
    into v_all_received
    from public.purchase_order_items where po_id = p_po;
  update public.purchase_orders set
    status = case when v_all_received then 'received' else 'partially_received' end,
    supplier_invoice_no = coalesce(p_invoice_no, supplier_invoice_no)
  where id = p_po;

  perform public.log_audit('po.receive', 'purchase_orders', p_po::text, null,
    jsonb_build_object('gr', v_gr_number, 'landed_cost', p_landed_cost), p_notes);

  return jsonb_build_object('gr_id', v_gr_id, 'gr_number', v_gr_number,
    'status', case when v_all_received then 'received' else 'partially_received' end);
end $$;

-- Record a supplier payment.
create or replace function public.supplier_pay(
  p_supplier uuid, p_amount numeric, p_method text default 'cash',
  p_po uuid default null, p_reference text default null,
  p_notes text default null, p_paid_at date default current_date
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.has_permission('purchasing.manage') then
    raise exception 'permission denied: purchasing.manage';
  end if;
  insert into public.supplier_payments
    (supplier_id, po_id, amount, method, reference_no, notes, paid_at, created_by)
  values (p_supplier, p_po, p_amount, p_method, p_reference, p_notes,
          coalesce(p_paid_at, current_date), auth.uid())
  returning id into v_id;
  perform public.log_audit('supplier.payment', 'supplier_payments', v_id::text, null,
    jsonb_build_object('supplier', p_supplier, 'amount', p_amount, 'po', p_po));
  return v_id;
end $$;

-- Payable per purchase order: received value (actual receipt costs + landed
-- + PO tax/shipping/discount applied on the received share) vs payments.
create or replace view public.v_po_payables
with (security_invoker = true) as
select
  po.id as po_id,
  po.po_number,
  po.supplier_id,
  s.name as supplier_name,
  po.status,
  po.order_date,
  po.expected_date,
  s.payment_terms_days,
  (po.order_date + s.payment_terms_days * interval '1 day')::date as due_date,
  coalesce(rv.received_value, 0) + po.tax + po.shipping - po.discount as billed_amount,
  coalesce(pay.paid, 0) as paid_amount,
  coalesce(rv.received_value, 0) + po.tax + po.shipping - po.discount
    - coalesce(pay.paid, 0) as balance
from public.purchase_orders po
join public.suppliers s on s.id = po.supplier_id
left join lateral (
  select coalesce((
           select sum(gri.qty_received * gri.unit_cost)
           from public.goods_receipts gr
           join public.goods_receipt_items gri on gri.gr_id = gr.id
           where gr.po_id = po.id), 0)
       + coalesce((
           select sum(gr.landed_cost)
           from public.goods_receipts gr
           where gr.po_id = po.id), 0) as received_value
) rv on true
left join lateral (
  select sum(amount) as paid from public.supplier_payments where po_id = po.id
) pay on true
where po.status not in ('draft', 'cancelled');

-- ---------------------------------------------------------------------------
-- Grants & RLS
-- ---------------------------------------------------------------------------
grant select on public.suppliers, public.purchase_orders, public.purchase_order_items,
  public.goods_receipts, public.goods_receipt_items, public.supplier_payments,
  public.v_po_payables to authenticated;
grant insert, update on public.suppliers, public.purchase_orders,
  public.purchase_order_items to authenticated;
grant delete on public.purchase_order_items to authenticated;
grant all on public.suppliers, public.purchase_orders, public.purchase_order_items,
  public.goods_receipts, public.goods_receipt_items, public.supplier_payments
  to service_role;

alter table public.suppliers enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
alter table public.goods_receipts enable row level security;
alter table public.goods_receipt_items enable row level security;
alter table public.supplier_payments enable row level security;

create policy suppliers_select on public.suppliers for select
  to authenticated using (
    public.has_permission('suppliers.manage') or public.has_permission('purchasing.view')
    or public.has_permission('inventory.view')
  );
create policy suppliers_insert on public.suppliers for insert
  to authenticated with check (public.has_permission('suppliers.manage'));
create policy suppliers_update on public.suppliers for update
  to authenticated using (public.has_permission('suppliers.manage'));

create policy po_select on public.purchase_orders for select
  to authenticated using (public.has_permission('purchasing.view'));
-- Draft/sent editing happens client-side; receiving is RPC-only.
create policy po_insert on public.purchase_orders for insert
  to authenticated with check (public.has_permission('purchasing.manage'));
create policy po_update on public.purchase_orders for update
  to authenticated using (
    public.has_permission('purchasing.manage')
    and status in ('draft', 'sent')
  );
create policy po_items_select on public.purchase_order_items for select
  to authenticated using (public.has_permission('purchasing.view'));
create policy po_items_insert on public.purchase_order_items for insert
  to authenticated with check (
    public.has_permission('purchasing.manage')
    and exists (select 1 from public.purchase_orders po
                where po.id = po_id and po.status = 'draft')
  );
create policy po_items_update on public.purchase_order_items for update
  to authenticated using (
    public.has_permission('purchasing.manage')
    and exists (select 1 from public.purchase_orders po
                where po.id = po_id and po.status = 'draft')
  );
create policy po_items_delete on public.purchase_order_items for delete
  to authenticated using (
    public.has_permission('purchasing.manage')
    and exists (select 1 from public.purchase_orders po
                where po.id = po_id and po.status = 'draft')
  );
create policy gr_select on public.goods_receipts for select
  to authenticated using (public.has_permission('purchasing.view'));
create policy gr_items_select on public.goods_receipt_items for select
  to authenticated using (public.has_permission('purchasing.view'));
create policy supplier_payments_select on public.supplier_payments for select
  to authenticated using (public.has_permission('purchasing.view'));

grant execute on function
  public.po_receive(uuid, jsonb, numeric, text, text),
  public.supplier_pay(uuid, numeric, text, uuid, text, text, date)
to authenticated;

-- PO numbering helper for client-created draft POs.
create or replace function public.po_create(
  p_supplier uuid, p_expected date default null, p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.has_permission('purchasing.manage') then
    raise exception 'permission denied: purchasing.manage';
  end if;
  insert into public.purchase_orders (po_number, supplier_id, expected_date, notes, created_by)
  values (public.next_doc_number('purchase_order'), p_supplier, p_expected, p_notes, auth.uid())
  returning id into v_id;
  return v_id;
end $$;
grant execute on function public.po_create(uuid, date, text) to authenticated;
