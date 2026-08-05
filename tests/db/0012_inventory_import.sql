-- Phase: inventory CSV import. Dry-run vs commit, validation, upsert by SKU,
-- opening stock via the ledger, and permission gating. Rolls back.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000e1', 'owner-imp@test', '{"full_name":"Iris","role":"owner"}'),
  ('00000000-0000-0000-0000-0000000000e2', 'cash-imp@test', '{"full_name":"Cam","role":"cashier"}');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true); -- owner

-- rows: 2 valid, 1 bad type, 1 bad unit, 1 missing name
do $$
declare
  rows jsonb := jsonb_build_array(
    jsonb_build_object('name','Oat Milk','sku','IMP-OAT','inventory_type','ingredient',
      'base_unit','ml','opening_stock','2000','unit_cost','0.25','reorder_level','500'),
    jsonb_build_object('name','Paper Cups','sku','IMP-CUP','inventory_type','packaging',
      'base_unit','pc','opening_stock','50','unit_cost','2'),
    jsonb_build_object('name','Bad Type','inventory_type','widget','base_unit','pc'),
    jsonb_build_object('name','Bad Unit','inventory_type','retail','base_unit','furlong'),
    jsonb_build_object('name','','inventory_type','supply','base_unit','pc')
  );
  res jsonb;
begin
  -- dry run: validates, writes nothing
  res := public.inventory_import(rows, false);
  if (res ->> 'valid')::int <> 2 then raise exception 'dry-run valid should be 2, got %', res ->> 'valid'; end if;
  if (res ->> 'error_count')::int <> 3 then raise exception 'dry-run errors should be 3, got %', res ->> 'error_count'; end if;
  if (res ->> 'created')::int <> 0 then raise exception 'dry-run must not create rows'; end if;
  if exists (select 1 from public.inventory_items where sku like 'IMP-%') then
    raise exception 'dry-run wrote items!';
  end if;

  -- commit: creates the 2 valid, posts opening stock
  res := public.inventory_import(rows, true);
  if (res ->> 'created')::int <> 2 then raise exception 'commit created should be 2, got %', res ->> 'created'; end if;
  if (res ->> 'stocked')::int <> 2 then raise exception 'commit stocked should be 2, got %', res ->> 'stocked'; end if;
  if (res ->> 'error_count')::int <> 3 then raise exception 'commit should still report 3 bad rows'; end if;
end $$;

-- opening stock + cost landed through the ledger
do $$
declare v_stock numeric; v_cost numeric;
begin
  select current_stock, avg_cost into v_stock, v_cost
    from public.inventory_items where sku = 'IMP-OAT';
  if v_stock <> 2000 then raise exception 'oat stock should be 2000, got %', v_stock; end if;
  if v_cost <> 0.25 then raise exception 'oat WAC should be 0.25, got %', v_cost; end if;
  -- a ledger movement exists
  if not exists (select 1 from public.inventory_movements m
                 join public.inventory_items i on i.id = m.item_id
                 where i.sku = 'IMP-OAT' and m.movement_type = 'opening_balance') then
    raise exception 'no opening_balance movement for imported item';
  end if;
end $$;

-- re-import same SKU updates in place (no duplicate), stock adds again
do $$
declare res jsonb; v_count int;
begin
  res := public.inventory_import(jsonb_build_array(
    jsonb_build_object('name','Oat Milk (Barista)','sku','IMP-OAT','inventory_type','ingredient',
      'base_unit','ml','reorder_level','800')), true);
  if (res ->> 'updated')::int <> 1 then raise exception 'second import should update 1, got %', res ->> 'updated'; end if;
  select count(*) into v_count from public.inventory_items where sku = 'IMP-OAT';
  if v_count <> 1 then raise exception 'SKU duplicated on re-import: % rows', v_count; end if;
  if (select name from public.inventory_items where sku='IMP-OAT') <> 'Oat Milk (Barista)' then
    raise exception 'update did not apply new name';
  end if;
end $$;

-- permission: cashier cannot import
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e2', true); -- cashier
do $$
begin
  perform public.inventory_import(jsonb_build_array(
    jsonb_build_object('name','X','inventory_type','supply','base_unit','pc')), true);
  raise exception 'cashier import must be denied';
exception when others then
  if sqlerrm like '%must be denied%' then raise; end if;
  if sqlerrm not like '%permission denied%' then
    raise exception 'unexpected error for cashier import: %', sqlerrm;
  end if;
end $$;

rollback;
