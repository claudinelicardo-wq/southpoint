-- 0002 Catalog & inventory: units, categories, products, variants, modifiers,
-- recipes, inventory items/batches/movements, and the stock ledger functions.

-- ---------------------------------------------------------------------------
-- Units
-- ---------------------------------------------------------------------------
create type public.unit_kind as enum ('mass', 'volume', 'count');

create table public.units (
  code text primary key,
  name text not null,
  kind public.unit_kind not null,
  -- factor to the canonical unit of its kind (g / ml / pc)
  factor numeric(14,6) not null check (factor > 0)
);

insert into public.units (code, name, kind, factor) values
  ('g',   'Gram',       'mass',   1),
  ('kg',  'Kilogram',   'mass',   1000),
  ('ml',  'Milliliter', 'volume', 1),
  ('l',   'Liter',      'volume', 1000),
  ('pc',  'Piece',      'count',  1),
  ('serving', 'Serving','count',  1);

-- Convert a quantity between units of the same kind.
create or replace function public.convert_units(p_qty numeric, p_from text, p_to text)
returns numeric
language plpgsql immutable as $$
declare f_from public.units%rowtype; f_to public.units%rowtype;
begin
  select * into f_from from public.units where code = p_from;
  if not found then raise exception 'unknown unit %', p_from; end if;
  select * into f_to from public.units where code = p_to;
  if not found then raise exception 'unknown unit %', p_to; end if;
  if f_from.kind <> f_to.kind then
    raise exception 'cannot convert % (%) to % (%)', p_from, f_from.kind, p_to, f_to.kind;
  end if;
  return p_qty * f_from.factor / f_to.factor;
end $$;

-- ---------------------------------------------------------------------------
-- Sales categories
-- ---------------------------------------------------------------------------
create type public.prep_station as enum ('bar', 'kitchen', 'none');

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  default_station public.prep_station not null default 'none',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger categories_updated_at before update on public.categories
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Inventory items
-- ---------------------------------------------------------------------------
create type public.inventory_type as enum
  ('ingredient', 'packaging', 'retail', 'prepared', 'supply');

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sku text unique,
  barcode text unique,
  inventory_type public.inventory_type not null,
  category text not null default '',
  base_unit text not null references public.units (code),
  -- How this item is bought: e.g. "1L carton" = 1000 base units (ml).
  purchase_unit_label text not null default '',
  purchase_to_base_factor numeric(14,6) not null default 1
    check (purchase_to_base_factor > 0),
  current_stock numeric(14,4) not null default 0,
  reorder_level numeric(14,4) not null default 0,
  target_level numeric(14,4) not null default 0,
  latest_cost numeric(14,6) not null default 0 check (latest_cost >= 0),
  avg_cost numeric(14,6) not null default 0 check (avg_cost >= 0),
  storage_location text not null default '',
  track_expiry boolean not null default false,
  default_supplier_id uuid, -- FK added in 0005 (suppliers)
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger inventory_items_updated_at before update on public.inventory_items
  for each row execute function public.set_updated_at();
create index inventory_items_type_idx on public.inventory_items (inventory_type)
  where archived_at is null;

-- Stock/cost columns may only change through the ledger functions below,
-- which set the southpoint.internal GUC for the transaction.
create or replace function public.guard_inventory_columns() returns trigger
language plpgsql as $$
begin
  if (new.current_stock is distinct from old.current_stock
      or new.avg_cost is distinct from old.avg_cost
      or new.latest_cost is distinct from old.latest_cost)
     and coalesce(current_setting('southpoint.internal', true), '') <> '1' then
    raise exception 'stock and cost columns can only be changed by inventory functions';
  end if;
  return new;
end $$;
create trigger inventory_items_guard before update on public.inventory_items
  for each row execute function public.guard_inventory_columns();

-- ---------------------------------------------------------------------------
-- Batches & movements (the ledger)
-- ---------------------------------------------------------------------------
create table public.inventory_batches (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items (id),
  qty_received numeric(14,4) not null check (qty_received > 0),
  qty_remaining numeric(14,4) not null check (qty_remaining >= 0),
  unit_cost numeric(14,6) not null check (unit_cost >= 0),
  received_at timestamptz not null default now(),
  expires_at date,
  supplier_id uuid,
  ref_type text,
  ref_id text,
  notes text,
  created_at timestamptz not null default now()
);
create index inventory_batches_fefo_idx
  on public.inventory_batches (item_id, expires_at asc nulls last, received_at asc)
  where qty_remaining > 0;

create type public.movement_type as enum (
  'purchase_receipt', 'sale', 'recipe_consumption', 'production_in',
  'production_consume', 'waste', 'spoilage', 'staff_meal', 'complimentary',
  'supplier_return', 'customer_return', 'count_adjust', 'manual_adjust',
  'opening_balance', 'transfer', 'void_reversal', 'refund_return'
);

create table public.inventory_movements (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.inventory_items (id),
  batch_id uuid references public.inventory_batches (id),
  movement_type public.movement_type not null,
  qty numeric(14,4) not null check (qty <> 0), -- signed, in base units
  unit_cost numeric(14,6) not null default 0,
  ref_type text,
  ref_id text,
  reason text,
  notes text,
  user_id uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index inventory_movements_item_idx on public.inventory_movements (item_id, created_at desc);
create index inventory_movements_ref_idx on public.inventory_movements (ref_type, ref_id);

-- ---------------------------------------------------------------------------
-- Ledger functions
-- ---------------------------------------------------------------------------

-- Add stock: creates a batch, a +movement, and updates cached stock + costs
-- (weighted-average). p_qty in base units, p_unit_cost per base unit.
create or replace function public.add_stock(
  p_item uuid, p_qty numeric, p_unit_cost numeric,
  p_movement_type public.movement_type,
  p_ref_type text default null, p_ref_id text default null,
  p_expires date default null, p_supplier uuid default null,
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_item public.inventory_items%rowtype; v_batch uuid; v_new_stock numeric;
begin
  if p_qty <= 0 then raise exception 'add_stock qty must be positive'; end if;
  if p_unit_cost < 0 then raise exception 'unit cost cannot be negative'; end if;

  select * into v_item from public.inventory_items where id = p_item for update;
  if not found then raise exception 'unknown inventory item'; end if;

  insert into public.inventory_batches
    (item_id, qty_received, qty_remaining, unit_cost, expires_at, supplier_id, ref_type, ref_id, notes)
  values (p_item, p_qty, p_qty, p_unit_cost, p_expires, p_supplier, p_ref_type, p_ref_id, p_notes)
  returning id into v_batch;

  insert into public.inventory_movements
    (item_id, batch_id, movement_type, qty, unit_cost, ref_type, ref_id, notes, user_id)
  values (p_item, v_batch, p_movement_type, p_qty, p_unit_cost, p_ref_type, p_ref_id, p_notes, auth.uid());

  v_new_stock := v_item.current_stock + p_qty;
  perform set_config('southpoint.internal', '1', true);
  update public.inventory_items set
    current_stock = v_new_stock,
    latest_cost = p_unit_cost,
    avg_cost = case
      when v_item.current_stock <= 0 then p_unit_cost
      else round((v_item.current_stock * v_item.avg_cost + p_qty * p_unit_cost) / v_new_stock, 6)
    end
  where id = p_item;
  perform set_config('southpoint.internal', '', true);

  return v_batch;
end $$;

-- Consume stock FEFO. Returns total cost consumed.
-- Expired batches are skipped unless p_allow_expired. If batches run out,
-- behavior follows the negative-stock policy (or p_allow_negative override).
create or replace function public.consume_stock(
  p_item uuid, p_qty numeric,
  p_movement_type public.movement_type,
  p_ref_type text default null, p_ref_id text default null,
  p_reason text default null, p_notes text default null,
  p_allow_expired boolean default false,
  p_allow_negative boolean default null
) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_item public.inventory_items%rowtype;
  v_remaining numeric := p_qty;
  v_total_cost numeric := 0;
  v_take numeric;
  v_allow_negative boolean;
  b record;
begin
  if p_qty <= 0 then raise exception 'consume_stock qty must be positive'; end if;

  select * into v_item from public.inventory_items where id = p_item for update;
  if not found then raise exception 'unknown inventory item'; end if;

  v_allow_negative := coalesce(
    p_allow_negative,
    coalesce((public.get_setting('inventory_policy') ->> 'allow_negative_stock')::boolean, false)
  );

  for b in
    select * from public.inventory_batches
    where item_id = p_item and qty_remaining > 0
      and (p_allow_expired or expires_at is null or expires_at >= current_date)
    order by expires_at asc nulls last, received_at asc
    for update
  loop
    exit when v_remaining <= 0;
    v_take := least(b.qty_remaining, v_remaining);
    update public.inventory_batches
       set qty_remaining = qty_remaining - v_take where id = b.id;
    insert into public.inventory_movements
      (item_id, batch_id, movement_type, qty, unit_cost, ref_type, ref_id, reason, notes, user_id)
    values (p_item, b.id, p_movement_type, -v_take, b.unit_cost,
            p_ref_type, p_ref_id, p_reason, p_notes, auth.uid());
    v_total_cost := v_total_cost + v_take * b.unit_cost;
    v_remaining := v_remaining - v_take;
  end loop;

  if v_remaining > 0 then
    if not v_allow_negative then
      raise exception 'insufficient stock for % (need % more %)',
        v_item.name, v_remaining, v_item.base_unit
        using errcode = 'P0001', hint = 'insufficient_stock';
    end if;
    -- Consume without a batch at the item's average cost.
    insert into public.inventory_movements
      (item_id, movement_type, qty, unit_cost, ref_type, ref_id, reason, notes, user_id)
    values (p_item, p_movement_type, -v_remaining, v_item.avg_cost,
            p_ref_type, p_ref_id, p_reason, p_notes, auth.uid());
    v_total_cost := v_total_cost + v_remaining * v_item.avg_cost;
  end if;

  perform set_config('southpoint.internal', '1', true);
  update public.inventory_items
     set current_stock = current_stock - p_qty where id = p_item;
  perform set_config('southpoint.internal', '', true);

  return round(v_total_cost, 6);
end $$;

-- Manual approved adjustment (requires inventory.adjust). Positive quantities
-- add stock at the given (or average) cost; negative quantities consume FEFO.
create or replace function public.inventory_adjust(
  p_item uuid, p_qty_delta numeric, p_reason text,
  p_notes text default null, p_unit_cost numeric default null,
  p_expires date default null,
  p_movement_type public.movement_type default 'manual_adjust'
) returns void
language plpgsql security definer set search_path = public as $$
declare v_cost numeric;
begin
  if not public.has_permission('inventory.adjust') then
    raise exception 'permission denied: inventory.adjust';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'a reason is required for stock adjustments';
  end if;
  if p_movement_type not in ('manual_adjust', 'opening_balance', 'count_adjust',
                             'supplier_return', 'customer_return', 'transfer') then
    raise exception 'invalid adjustment movement type %', p_movement_type;
  end if;

  if p_qty_delta > 0 then
    select coalesce(p_unit_cost, nullif(avg_cost, 0), latest_cost)
      into v_cost from public.inventory_items where id = p_item;
    perform public.add_stock(p_item, p_qty_delta, coalesce(v_cost, 0),
      p_movement_type, 'adjustment', null, p_expires, null, p_notes);
  elsif p_qty_delta < 0 then
    perform public.consume_stock(p_item, -p_qty_delta, p_movement_type,
      'adjustment', null, p_reason, p_notes, true, true);
  else
    raise exception 'adjustment quantity cannot be zero';
  end if;

  perform public.log_audit('inventory.adjust', 'inventory_items', p_item::text,
    null, jsonb_build_object('qty_delta', p_qty_delta, 'movement_type', p_movement_type),
    p_reason);
end $$;

-- Ledger reconciliation check: cached stock must equal the movement sum.
create or replace function public.verify_stock_reconciliation()
returns table (item_id uuid, cached numeric, ledger numeric)
language sql security definer set search_path = public as $$
  select i.id, i.current_stock, coalesce(sum(m.qty), 0)
  from public.inventory_items i
  left join public.inventory_movements m on m.item_id = i.id
  group by i.id
  having i.current_stock <> coalesce(sum(m.qty), 0)
$$;

-- ---------------------------------------------------------------------------
-- Products (unified sellable: prepared café items + retail goods)
-- ---------------------------------------------------------------------------
create type public.product_kind as enum ('prepared', 'retail');

create table public.products (
  id uuid primary key default gen_random_uuid(),
  kind public.product_kind not null,
  name text not null,
  category_id uuid not null references public.categories (id),
  price numeric(12,2) not null check (price >= 0),
  image_url text,
  station public.prep_station not null default 'none',
  prep_minutes int not null default 0,
  is_available boolean not null default true,
  tax_exempt boolean not null default false,
  -- retail products deduct one unit of this inventory item per sale
  inventory_item_id uuid references public.inventory_items (id),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint retail_needs_item check (kind <> 'retail' or inventory_item_id is not null),
  constraint prepared_no_item check (kind <> 'prepared' or inventory_item_id is null)
);
create trigger products_updated_at before update on public.products
  for each row execute function public.set_updated_at();
create index products_category_idx on public.products (category_id) where archived_at is null;

-- Audit price changes.
create or replace function public.audit_product_changes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.price is distinct from old.price then
    perform public.log_audit('product.price_change', 'products', new.id::text,
      jsonb_build_object('price', old.price), jsonb_build_object('price', new.price));
  end if;
  return new;
end $$;
create trigger products_audit_price after update on public.products
  for each row execute function public.audit_product_changes();

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  name text not null,
  price_delta numeric(12,2) not null default 0,
  is_default boolean not null default false,
  is_available boolean not null default true,
  sort_order int not null default 0,
  unique (product_id, name)
);

-- ---------------------------------------------------------------------------
-- Recipes (per prepared product; lines may be variant-specific)
-- ---------------------------------------------------------------------------
create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  -- null = applies to all variants; set = applies only to that variant
  variant_id uuid references public.product_variants (id) on delete cascade,
  item_id uuid not null references public.inventory_items (id),
  qty numeric(14,4) not null check (qty > 0), -- in the item's base unit
  waste_pct numeric(5,2) not null default 0 check (waste_pct >= 0 and waste_pct < 100),
  is_optional boolean not null default false,
  created_at timestamptz not null default now()
);
create index recipe_ingredients_product_idx on public.recipe_ingredients (product_id);

create or replace function public.audit_recipe_changes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit(
    'recipe.' || lower(tg_op), 'recipe_ingredients',
    coalesce(new.id, old.id)::text,
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
create trigger recipe_ingredients_audit
  after insert or update or delete on public.recipe_ingredients
  for each row execute function public.audit_recipe_changes();

-- ---------------------------------------------------------------------------
-- Modifiers
-- ---------------------------------------------------------------------------
create table public.modifier_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  selection text not null default 'single' check (selection in ('single', 'multi')),
  is_required boolean not null default false,
  min_select int not null default 0,
  max_select int not null default 1,
  sort_order int not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.modifier_options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.modifier_groups (id) on delete cascade,
  name text not null,
  price_delta numeric(12,2) not null default 0,
  is_available boolean not null default true,
  station_override public.prep_station,
  sort_order int not null default 0,
  unique (group_id, name)
);

-- Inventory effect of choosing an option. One row can express:
--   add (add_item set), remove (remove_item set), replace (both set).
create table public.modifier_option_effects (
  id uuid primary key default gen_random_uuid(),
  option_id uuid not null references public.modifier_options (id) on delete cascade,
  add_item_id uuid references public.inventory_items (id),
  add_qty numeric(14,4) check (add_qty is null or add_qty > 0),
  remove_item_id uuid references public.inventory_items (id),
  remove_qty numeric(14,4) check (remove_qty is null or remove_qty > 0),
  constraint effect_not_empty check (add_item_id is not null or remove_item_id is not null),
  constraint add_pair check ((add_item_id is null) = (add_qty is null)),
  constraint remove_pair check ((remove_item_id is null) = (remove_qty is null))
);

create table public.product_modifier_groups (
  product_id uuid not null references public.products (id) on delete cascade,
  group_id uuid not null references public.modifier_groups (id) on delete cascade,
  sort_order int not null default 0,
  primary key (product_id, group_id)
);

-- ---------------------------------------------------------------------------
-- Costing view: current estimated cost per product variant (base recipe only;
-- modifier effects are costed at sale time).
-- ---------------------------------------------------------------------------
create or replace view public.v_product_cost
with (security_invoker = true) as
select
  p.id as product_id,
  v.id as variant_id,
  p.price + coalesce(v.price_delta, 0) as selling_price,
  coalesce(sum(
    case when ri.variant_id is null or ri.variant_id = v.id
      then round(ri.qty * (1 + ri.waste_pct / 100) * i.avg_cost, 4)
      else 0 end
  ), 0) as estimated_cost
from public.products p
left join public.product_variants v on v.product_id = p.id
left join public.recipe_ingredients ri on ri.product_id = p.id
left join public.inventory_items i on i.id = ri.item_id
where p.kind = 'prepared'
group by p.id, v.id, p.price, v.price_delta;

-- ---------------------------------------------------------------------------
-- Grants & RLS
-- ---------------------------------------------------------------------------
grant select on public.units, public.categories, public.inventory_items,
  public.inventory_batches, public.inventory_movements, public.products,
  public.product_variants, public.recipe_ingredients, public.modifier_groups,
  public.modifier_options, public.modifier_option_effects,
  public.product_modifier_groups, public.v_product_cost to authenticated;

grant insert, update on public.categories, public.products, public.product_variants,
  public.recipe_ingredients, public.modifier_groups, public.modifier_options,
  public.modifier_option_effects, public.product_modifier_groups,
  public.inventory_items to authenticated;
grant delete on public.recipe_ingredients, public.modifier_option_effects,
  public.product_modifier_groups, public.product_variants to authenticated;

grant all on public.units, public.categories, public.inventory_items,
  public.inventory_batches, public.inventory_movements, public.products,
  public.product_variants, public.recipe_ingredients, public.modifier_groups,
  public.modifier_options, public.modifier_option_effects,
  public.product_modifier_groups to service_role;

alter table public.units enable row level security;
alter table public.categories enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_batches enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.modifier_groups enable row level security;
alter table public.modifier_options enable row level security;
alter table public.modifier_option_effects enable row level security;
alter table public.product_modifier_groups enable row level security;

-- Catalog is readable by any active staff (the POS needs it).
create policy units_select on public.units for select
  to authenticated using (public.is_active_staff());
create policy categories_select on public.categories for select
  to authenticated using (public.is_active_staff());
create policy products_select on public.products for select
  to authenticated using (public.is_active_staff());
create policy variants_select on public.product_variants for select
  to authenticated using (public.is_active_staff());
create policy modifier_groups_select on public.modifier_groups for select
  to authenticated using (public.is_active_staff());
create policy modifier_options_select on public.modifier_options for select
  to authenticated using (public.is_active_staff());
create policy modifier_effects_select on public.modifier_option_effects for select
  to authenticated using (public.is_active_staff());
create policy product_modifiers_select on public.product_modifier_groups for select
  to authenticated using (public.is_active_staff());
create policy recipes_select on public.recipe_ingredients for select
  to authenticated using (public.has_permission('catalog.view'));

-- Inventory data needs inventory.view (or catalog.manage for recipe costing).
create policy inventory_items_select on public.inventory_items for select
  to authenticated using (
    public.has_permission('inventory.view') or public.has_permission('catalog.manage')
    or public.has_permission('catalog.view')
  );
create policy inventory_batches_select on public.inventory_batches for select
  to authenticated using (public.has_permission('inventory.view'));
create policy inventory_movements_select on public.inventory_movements for select
  to authenticated using (public.has_permission('inventory.view'));

-- Catalog writes require catalog.manage.
create policy categories_write on public.categories for insert
  to authenticated with check (public.has_permission('catalog.manage'));
create policy categories_update on public.categories for update
  to authenticated using (public.has_permission('catalog.manage'));
create policy products_write on public.products for insert
  to authenticated with check (public.has_permission('catalog.manage'));
create policy products_update on public.products for update
  to authenticated using (
    public.has_permission('catalog.manage')
    -- kitchen staff may toggle availability when permitted
    or public.has_permission('kds.update')
  );
create policy variants_write on public.product_variants for insert
  to authenticated with check (public.has_permission('catalog.manage'));
create policy variants_update on public.product_variants for update
  to authenticated using (public.has_permission('catalog.manage'));
create policy variants_delete on public.product_variants for delete
  to authenticated using (public.has_permission('catalog.manage'));
create policy recipes_write on public.recipe_ingredients for insert
  to authenticated with check (public.has_permission('catalog.manage'));
create policy recipes_update on public.recipe_ingredients for update
  to authenticated using (public.has_permission('catalog.manage'));
create policy recipes_delete on public.recipe_ingredients for delete
  to authenticated using (public.has_permission('catalog.manage'));
create policy modifier_groups_write on public.modifier_groups for insert
  to authenticated with check (public.has_permission('catalog.manage'));
create policy modifier_groups_update on public.modifier_groups for update
  to authenticated using (public.has_permission('catalog.manage'));
create policy modifier_options_write on public.modifier_options for insert
  to authenticated with check (public.has_permission('catalog.manage'));
create policy modifier_options_update on public.modifier_options for update
  to authenticated using (public.has_permission('catalog.manage'));
create policy modifier_effects_write on public.modifier_option_effects for insert
  to authenticated with check (public.has_permission('catalog.manage'));
create policy modifier_effects_update on public.modifier_option_effects for update
  to authenticated using (public.has_permission('catalog.manage'));
create policy modifier_effects_delete on public.modifier_option_effects for delete
  to authenticated using (public.has_permission('catalog.manage'));
create policy product_modifiers_write on public.product_modifier_groups for insert
  to authenticated with check (public.has_permission('catalog.manage'));
create policy product_modifiers_delete on public.product_modifier_groups for delete
  to authenticated using (public.has_permission('catalog.manage'));

-- Inventory item metadata edits (stock/cost columns are trigger-guarded).
create policy inventory_items_write on public.inventory_items for insert
  to authenticated with check (
    public.has_permission('inventory.adjust') or public.has_permission('catalog.manage')
  );
create policy inventory_items_update on public.inventory_items for update
  to authenticated using (
    public.has_permission('inventory.adjust') or public.has_permission('catalog.manage')
  );

-- Batches and movements are written only by the ledger functions.

grant execute on function
  public.convert_units(numeric, text, text),
  public.inventory_adjust(uuid, numeric, text, text, numeric, date, public.movement_type),
  public.verify_stock_reconciliation()
to authenticated;
