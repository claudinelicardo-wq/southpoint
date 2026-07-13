-- 0010 Single pickleball court: lightweight session/status tracking.
-- One court only — the "current" session is the row with ended_at IS NULL.
-- History is simply the ended sessions. Modular enough that a future booking
-- feature can layer on top without touching the POS.

create table public.court_sessions (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('reserved', 'in_use', 'cleaning', 'maintenance')),
  group_label text,
  customer_id uuid references public.customers (id),
  tab_id uuid references public.tabs (id),
  starts_at timestamptz not null default now(),
  expected_end_at timestamptz,
  ended_at timestamptz,
  booking_reference text,
  notes text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);
create unique index court_one_active on public.court_sessions ((true)) where ended_at is null;
create index court_sessions_history_idx on public.court_sessions (starts_at desc);

-- Set the court status: ends any active session, then (unless returning to
-- 'available') starts the new one.
create or replace function public.court_set(
  p_status text, p_group_label text default null, p_customer uuid default null,
  p_tab uuid default null, p_expected_end timestamptz default null,
  p_booking_reference text default null, p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.has_permission('court.manage') then
    raise exception 'permission denied: court.manage';
  end if;
  if p_status not in ('available', 'reserved', 'in_use', 'cleaning', 'maintenance') then
    raise exception 'unknown court status %', p_status;
  end if;

  update public.court_sessions set ended_at = now() where ended_at is null;

  if p_status = 'available' then
    return null;
  end if;

  insert into public.court_sessions
    (status, group_label, customer_id, tab_id, expected_end_at,
     booking_reference, notes, created_by)
  values (p_status, nullif(btrim(coalesce(p_group_label, '')), ''), p_customer, p_tab,
          p_expected_end, p_booking_reference, p_notes, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

grant select on public.court_sessions to authenticated;
grant all on public.court_sessions to service_role;
alter table public.court_sessions enable row level security;
create policy court_select on public.court_sessions for select
  to authenticated using (public.is_active_staff());

grant execute on function
  public.court_set(text, text, uuid, uuid, timestamptz, text, text)
to authenticated;

alter publication supabase_realtime add table public.court_sessions;
