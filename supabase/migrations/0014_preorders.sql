-- 0014 Customer pre-orders.
--
-- Public customers place pickup orders ahead of time from /preorder: they pay
-- via GCash to the posted QR and submit the reference number; staff verify the
-- payment manually and confirm. A pre-order never touches inventory, payments,
-- or orders — at pickup, staff ring it through the POS like any sale, so all
-- money-critical logic stays on the one tested path.
--
-- Access model: RLS is enabled with NO client policies. Every read and write
-- goes through the app server using the service-role key (public submit is a
-- validated API route; the staff page is permission-checked server-side).
-- Anonymous browsers never talk to this table directly.

create table public.preorders (
  id uuid primary key default gen_random_uuid(),
  preorder_number text not null unique,
  customer_name text not null,
  customer_phone text not null,
  pickup_date date not null,
  pickup_slot time not null,           -- start of the 30-minute window
  status text not null default 'pending' check (status in
    ('pending', 'confirmed', 'ready', 'picked_up', 'rejected', 'cancelled')),
  -- Line-item snapshot priced server-side at submission:
  -- [{product_id, name, variant_id, variant_name, qty, unit_price, line_total}]
  items jsonb not null,
  total numeric(12,2) not null check (total >= 0),
  gcash_reference text not null,
  notes text,
  reject_reason text,
  handled_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger preorders_updated_at before update on public.preorders
  for each row execute function public.set_updated_at();
create index preorders_pickup_idx on public.preorders (pickup_date, pickup_slot);
create index preorders_status_idx on public.preorders (status);

alter table public.preorders enable row level security;
-- Deliberately no policies: service-role only.
grant all on public.preorders to service_role;

insert into public.doc_counters (kind, prefix) values ('preorder', 'PR')
on conflict (kind) do nothing;

insert into public.settings (key, value, is_sensitive) values
  ('preorders', jsonb_build_object(
     'enabled', false,
     'open_time', '10:00',
     'close_time', '21:00',
     'slot_capacity', 4,
     'lead_minutes', 45
   ), false)
on conflict (key) do nothing;
