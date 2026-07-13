-- 0008 Expenses: categories and expense records with an approval flow.

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  archived_at timestamptz
);

insert into public.expense_categories (name, sort_order) values
  ('Ingredients', 1), ('Packaging', 2), ('Utilities', 3), ('Rent', 4),
  ('Salaries', 5), ('Repairs', 6), ('Cleaning Supplies', 7), ('Equipment', 8),
  ('Internet', 9), ('Transportation', 10), ('Marketing', 11), ('Permits', 12),
  ('Miscellaneous', 13);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  exp_number text not null unique,
  expense_date date not null default current_date,
  category_id uuid not null references public.expense_categories (id),
  vendor text not null default '',
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  method text not null default 'cash',
  reference_no text,
  receipt_url text,
  is_recurring boolean not null default false,
  notes text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_by uuid not null references public.profiles (id),
  approved_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger expenses_updated_at before update on public.expenses
  for each row execute function public.set_updated_at();
create index expenses_date_idx on public.expenses (expense_date desc);

-- Create through an RPC so numbering + audit are consistent. Approvers'
-- expenses are auto-approved.
create or replace function public.expense_create(
  p_date date, p_category uuid, p_vendor text, p_description text,
  p_amount numeric, p_method text default 'cash', p_reference text default null,
  p_receipt_url text default null, p_recurring boolean default false,
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_auto boolean;
begin
  if not public.has_permission('expenses.manage') then
    raise exception 'permission denied: expenses.manage';
  end if;
  v_auto := public.has_permission('expenses.approve');
  insert into public.expenses
    (exp_number, expense_date, category_id, vendor, description, amount, method,
     reference_no, receipt_url, is_recurring, notes, status, created_by, approved_by)
  values
    (public.next_doc_number('expense'), coalesce(p_date, current_date), p_category,
     coalesce(p_vendor, ''), p_description, p_amount, coalesce(p_method, 'cash'),
     p_reference, p_receipt_url, coalesce(p_recurring, false), p_notes,
     case when v_auto then 'approved' else 'pending' end,
     auth.uid(), case when v_auto then auth.uid() end)
  returning id into v_id;
  perform public.log_audit('expense.create', 'expenses', v_id::text, null,
    jsonb_build_object('amount', p_amount, 'auto_approved', v_auto));
  return v_id;
end $$;

create or replace function public.expense_resolve(p_expense uuid, p_approve boolean, p_notes text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('expenses.approve') then
    raise exception 'permission denied: expenses.approve';
  end if;
  update public.expenses set
    status = case when p_approve then 'approved' else 'rejected' end,
    approved_by = auth.uid(), notes = coalesce(p_notes, notes)
  where id = p_expense and status = 'pending';
  if not found then raise exception 'expense is not pending'; end if;
  perform public.log_audit(
    'expense.' || case when p_approve then 'approve' else 'reject' end,
    'expenses', p_expense::text, null, null, p_notes);
end $$;

grant select on public.expense_categories, public.expenses to authenticated;
grant insert, update on public.expense_categories to authenticated;
grant all on public.expense_categories, public.expenses to service_role;

alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security;

create policy expense_categories_select on public.expense_categories for select
  to authenticated using (public.is_active_staff());
create policy expense_categories_write on public.expense_categories for insert
  to authenticated with check (public.has_permission('expenses.manage'));
create policy expense_categories_update on public.expense_categories for update
  to authenticated using (public.has_permission('expenses.manage'));
create policy expenses_select on public.expenses for select
  to authenticated using (public.has_permission('expenses.view'));

grant execute on function
  public.expense_create(date, uuid, text, text, numeric, text, text, text, boolean, text),
  public.expense_resolve(uuid, boolean, text)
to authenticated;
