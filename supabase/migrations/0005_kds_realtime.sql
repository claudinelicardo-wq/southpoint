-- 0005 Realtime for the kitchen/bar display: publish order changes.
-- Supabase provides the supabase_realtime publication; the local test harness
-- doesn't, so create it when missing to keep migrations portable.
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

alter publication supabase_realtime add table public.order_items;
alter publication supabase_realtime add table public.orders;

-- Replica identity so UPDATE payloads include old row keys.
alter table public.order_items replica identity full;
