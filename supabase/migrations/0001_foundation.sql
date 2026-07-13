-- 0001 Foundation: identity, roles/permissions, settings, audit logs, doc counters, helpers.
-- All statements are idempotent-safe for a fresh database; migrations run in order.

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
create type public.staff_role as enum
  ('owner', 'manager', 'cashier', 'kitchen', 'inventory', 'accountant');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  role public.staff_role not null default 'cashier',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile when an auth user is created (role/name from metadata).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, role, is_active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce((new.raw_user_meta_data ->> 'role')::public.staff_role, 'cashier'),
    coalesce((new.raw_user_meta_data ->> 'is_active')::boolean, true)
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
create table public.role_permissions (
  role public.staff_role not null,
  permission text not null,
  primary key (role, permission)
);

create or replace function public.current_staff_role() returns public.staff_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_active_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_active)
$$;

-- Single authorization gate used by RLS policies and RPCs.
-- Owner implicitly holds every permission (including keys added in later phases).
create or replace function public.has_permission(perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when r is null then false
    when r = 'owner' then true
    else exists (select 1 from public.role_permissions rp
                 where rp.role = r and rp.permission = perm)
  end
  from (select public.current_staff_role() as r) s
$$;

-- Default permission matrix (owner-editable at runtime; owner needs no rows).
insert into public.role_permissions (role, permission) values
  -- manager: operations + most reports; sensitive config and staff stay owner-only
  ('manager', 'pos.sell'), ('manager', 'pos.discount.manual'),
  ('manager', 'pos.refund'), ('manager', 'pos.void'),
  ('manager', 'tabs.manage'), ('manager', 'tabs.reopen'),
  ('manager', 'orders.view'), ('manager', 'kds.view'), ('manager', 'kds.update'),
  ('manager', 'catalog.view'), ('manager', 'catalog.manage'),
  ('manager', 'inventory.view'), ('manager', 'inventory.adjust'),
  ('manager', 'inventory.receive'), ('manager', 'inventory.count'),
  ('manager', 'inventory.waste'), ('manager', 'inventory.waste.approve'),
  ('manager', 'inventory.produce'),
  ('manager', 'purchasing.view'), ('manager', 'purchasing.manage'),
  ('manager', 'suppliers.manage'),
  ('manager', 'expenses.view'), ('manager', 'expenses.manage'), ('manager', 'expenses.approve'),
  ('manager', 'customers.view.basic'), ('manager', 'customers.manage'),
  ('manager', 'loyalty.manage'), ('manager', 'loyalty.adjust'),
  ('manager', 'shifts.own'), ('manager', 'shifts.manage'), ('manager', 'shifts.view_expected_cash'),
  ('manager', 'reports.sales'), ('manager', 'reports.profit'),
  ('manager', 'reports.inventory'), ('manager', 'reports.shifts'), ('manager', 'reports.export'),
  ('manager', 'settings.manage'),
  ('manager', 'court.manage'),
  -- cashier
  ('cashier', 'pos.sell'), ('cashier', 'tabs.manage'), ('cashier', 'orders.view'),
  ('cashier', 'kds.view'), ('cashier', 'catalog.view'),
  ('cashier', 'customers.view.basic'), ('cashier', 'shifts.own'),
  ('cashier', 'court.manage'),
  -- kitchen / barista
  ('kitchen', 'kds.view'), ('kitchen', 'kds.update'),
  ('kitchen', 'catalog.view'), ('kitchen', 'inventory.waste'),
  -- inventory staff
  ('inventory', 'catalog.view'),
  ('inventory', 'inventory.view'), ('inventory', 'inventory.adjust'),
  ('inventory', 'inventory.receive'), ('inventory', 'inventory.count'),
  ('inventory', 'inventory.waste'), ('inventory', 'inventory.produce'),
  ('inventory', 'purchasing.view'), ('inventory', 'purchasing.manage'),
  ('inventory', 'suppliers.manage'),
  -- accountant
  ('accountant', 'expenses.view'), ('accountant', 'expenses.manage'), ('accountant', 'expenses.approve'),
  ('accountant', 'purchasing.view'),
  ('accountant', 'reports.sales'), ('accountant', 'reports.profit'),
  ('accountant', 'reports.inventory'), ('accountant', 'reports.shifts'),
  ('accountant', 'reports.export'),
  ('accountant', 'orders.view');

-- ---------------------------------------------------------------------------
-- Audit logs (append-only)
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles (id),
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  reason text,
  session_info jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_entity_idx on public.audit_logs (entity, entity_id);
create index audit_logs_created_idx on public.audit_logs (created_at desc);

create or replace function public.audit_logs_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_logs are immutable';
end $$;

create trigger audit_logs_no_update
  before update or delete on public.audit_logs
  for each row execute function public.audit_logs_immutable();

-- Internal helper: only callable from other definer functions (no client grant).
create or replace function public.log_audit(
  p_action text, p_entity text, p_entity_id text,
  p_before jsonb default null, p_after jsonb default null, p_reason text default null
) returns void
language sql security definer set search_path = public as $$
  insert into public.audit_logs (user_id, action, entity, entity_id, before, after, reason)
  values (auth.uid(), p_action, p_entity, p_entity_id, p_before, p_after, p_reason)
$$;

-- Service-role variant with an explicit actor, for server routes that act on
-- behalf of a signed-in owner (e.g. staff account creation). Not granted to
-- authenticated.
create or replace function public.log_audit_service(
  p_actor uuid, p_action text, p_entity text, p_entity_id text,
  p_before jsonb default null, p_after jsonb default null, p_reason text default null
) returns void
language sql security definer set search_path = public as $$
  insert into public.audit_logs (user_id, action, entity, entity_id, before, after, reason)
  values (p_actor, p_action, p_entity, p_entity_id, p_before, p_after, p_reason)
$$;

-- ---------------------------------------------------------------------------
-- Settings (key/value jsonb; sensitive keys owner-only)
-- ---------------------------------------------------------------------------
create table public.settings (
  key text primary key,
  value jsonb not null,
  is_sensitive boolean not null default false,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

insert into public.settings (key, value, is_sensitive) values
  ('business_profile', jsonb_build_object(
     'name', 'South Point Cafe & Lounge',
     'address', '', 'phone', '', 'email', '',
     'tagline', 'Courtside café · Convenience store · Pickleball lounge'
   ), false),
  ('locale', jsonb_build_object('currency', 'PHP', 'timezone', 'Asia/Manila'), false),
  ('tax', jsonb_build_object(
     'vat_registered', false, 'pricing_mode', 'tax_inclusive', 'vat_rate', 0.12,
     'service_charge_rate', 0, 'sc_pwd_discount_rate', 0.20,
     'sc_pwd_vat_exempt', true
   ), true),
  ('receipt', jsonb_build_object(
     'width_mm', 58, 'footer', 'Thank you! See you courtside.',
     'show_loyalty_points', true
   ), false),
  ('inventory_policy', jsonb_build_object(
     'allow_negative_stock', false, 'low_stock_behavior', 'warn',
     'expiring_soon_days', 7
   ), true),
  ('shifts', jsonb_build_object('show_expected_cash_before_count', false), true),
  ('loyalty', jsonb_build_object(
     'enabled', true, 'points_per_peso', 0.02, 'min_purchase', 100,
     'redemption_value_per_point', 1, 'max_redemption_pct', 0.5,
     'points_expiry_days', 365, 'birthday_bonus_points', 50
   ), true);

create or replace function public.set_setting(p_key text, p_value jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare v_old jsonb; v_sensitive boolean;
begin
  select value, is_sensitive into v_old, v_sensitive
    from public.settings where key = p_key for update;
  if not found then
    raise exception 'unknown setting %', p_key;
  end if;
  if v_sensitive then
    if public.current_staff_role() is distinct from 'owner' then
      raise exception 'permission denied: setting % is owner-only', p_key;
    end if;
  elsif not public.has_permission('settings.manage') then
    raise exception 'permission denied: settings.manage';
  end if;
  update public.settings
     set value = p_value, updated_by = auth.uid(), updated_at = now()
   where key = p_key;
  perform public.log_audit('settings.update', 'settings', p_key, v_old, p_value);
end $$;

create or replace function public.get_setting(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$
  select value from public.settings where key = p_key
$$;

-- ---------------------------------------------------------------------------
-- Staff management RPCs (owner-only)
-- ---------------------------------------------------------------------------
create or replace function public.staff_update(
  p_user uuid, p_full_name text, p_role public.staff_role, p_is_active boolean,
  p_reason text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_before jsonb;
begin
  if not public.has_permission('staff.manage') then
    raise exception 'permission denied: staff.manage';
  end if;
  select to_jsonb(p) into v_before from public.profiles p where id = p_user;
  if v_before is null then
    raise exception 'unknown staff member';
  end if;
  if p_user = auth.uid() and (p_role is distinct from 'owner' or not p_is_active) then
    raise exception 'you cannot demote or deactivate your own account';
  end if;
  update public.profiles
     set full_name = p_full_name, role = p_role, is_active = p_is_active
   where id = p_user;
  perform public.log_audit('staff.update', 'profiles', p_user::text, v_before,
    (select to_jsonb(p) from public.profiles p where id = p_user), p_reason);
end $$;

create or replace function public.role_permission_set(
  p_role public.staff_role, p_permission text, p_granted boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.current_staff_role() is distinct from 'owner' then
    raise exception 'permission denied: owner only';
  end if;
  if p_role = 'owner' then
    raise exception 'owner permissions are implicit and cannot be edited';
  end if;
  if p_granted then
    insert into public.role_permissions values (p_role, p_permission)
    on conflict do nothing;
  else
    delete from public.role_permissions where role = p_role and permission = p_permission;
  end if;
  perform public.log_audit('permissions.update', 'role_permissions',
    p_role || ':' || p_permission, null, jsonb_build_object('granted', p_granted));
end $$;

-- ---------------------------------------------------------------------------
-- Document counters (order/PO/receipt numbers)
-- ---------------------------------------------------------------------------
create table public.doc_counters (
  kind text primary key,
  prefix text not null,
  last_value bigint not null default 0
);

insert into public.doc_counters (kind, prefix) values
  ('order', 'SP'), ('purchase_order', 'PO'), ('goods_receipt', 'GR'),
  ('stock_count', 'SC'), ('production', 'PB'), ('refund', 'RF'),
  ('expense', 'EX'), ('waste', 'WS');

create or replace function public.next_doc_number(p_kind text) returns text
language plpgsql security definer set search_path = public as $$
declare v bigint; v_prefix text;
begin
  update public.doc_counters
     set last_value = last_value + 1
   where kind = p_kind
   returning last_value, prefix into v, v_prefix;
  if v is null then
    raise exception 'unknown doc counter %', p_kind;
  end if;
  return v_prefix || '-' || lpad(v::text, 6, '0');
end $$;

-- ---------------------------------------------------------------------------
-- Grants & RLS
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;

-- Deliberate, minimal grants. RLS further restricts rows.
grant select on public.profiles          to authenticated;
grant select on public.role_permissions  to authenticated;
grant select on public.settings          to authenticated;
grant select on public.audit_logs        to authenticated;
grant all    on public.profiles, public.role_permissions, public.settings,
              public.audit_logs, public.doc_counters to service_role;

alter table public.profiles         enable row level security;
alter table public.role_permissions enable row level security;
alter table public.settings         enable row level security;
alter table public.audit_logs       enable row level security;
alter table public.doc_counters     enable row level security;

-- Profiles: active staff can see all names (needed to display "who did what");
-- inactive/unknown users see only themselves.
create policy profiles_select on public.profiles for select
  to authenticated using (public.is_active_staff() or id = auth.uid());

-- Role permission matrix is readable by active staff (drives navigation).
create policy role_permissions_select on public.role_permissions for select
  to authenticated using (public.is_active_staff());

-- Settings are readable by active staff (the POS needs tax/receipt/loyalty config
-- for display; server RPCs recompute all money anyway). `is_sensitive` marks keys
-- whose WRITE is owner-only — enforced in set_setting().
create policy settings_select on public.settings for select
  to authenticated using (public.is_active_staff());

create policy audit_logs_select on public.audit_logs for select
  to authenticated using (public.has_permission('audit.view'));

-- doc_counters: no client policies (RPC-only).

-- Lock down function execution: deny by default, grant explicitly.
-- The default-privileges change also covers functions created in later migrations.
alter default privileges in schema public revoke execute on functions from public;
revoke execute on all functions in schema public from public, anon;
grant execute on function public.log_audit_service(uuid, text, text, text, jsonb, jsonb, text)
  to service_role;
grant execute on function
  public.has_permission(text),
  public.current_staff_role(),
  public.is_active_staff(),
  public.set_setting(text, jsonb),
  public.get_setting(text),
  public.staff_update(uuid, text, public.staff_role, boolean, text),
  public.role_permission_set(public.staff_role, text, boolean)
to authenticated;
