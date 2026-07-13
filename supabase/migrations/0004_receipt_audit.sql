-- 0004 Receipt reprint audit.
create or replace function public.log_receipt_reprint(p_order uuid)
returns void
language sql security definer set search_path = public as $$
  select public.log_audit('receipt.print', 'orders', p_order::text);
$$;
grant execute on function public.log_receipt_reprint(uuid) to authenticated;
