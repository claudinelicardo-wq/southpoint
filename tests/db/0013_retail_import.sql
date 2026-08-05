-- Phase: retail-product CSV import. Each row -> sellable product (priced at SRP)
-- + stock item (opening Quantity at Cost) + Brand. Dry-run, commit, upsert,
-- permission gate. Rolls back.
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000f5', 'owner-ret@test', '{"full_name":"Rita","role":"owner"}'),
  ('00000000-0000-0000-0000-0000000000f6', 'cash-ret@test', '{"full_name":"Cal","role":"cashier"}');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f5', true); -- owner

do $$
declare
  rows jsonb := jsonb_build_array(
    jsonb_build_object('name','Coke Mismo','brand','Coca-Cola','sku','RET-COKE',
      'quantity','24','cost','12','srp','20'),
    jsonb_build_object('name','Piattos','brand','Jack n Jill','sku','RET-PIAT',
      'quantity','30','cost','15','srp','22'),
    jsonb_build_object('name','','brand','NoName','quantity','5','cost','1','srp','2')
  );
  res jsonb;
begin
  -- dry run
  res := public.retail_import(rows, false);
  if (res ->> 'valid')::int <> 2 then raise exception 'dry valid should be 2, got %', res ->> 'valid'; end if;
  if (res ->> 'error_count')::int <> 1 then raise exception 'dry errors should be 1, got %', res ->> 'error_count'; end if;
  if exists (select 1 from public.products where name = 'Coke Mismo') then raise exception 'dry run wrote a product!'; end if;

  -- commit
  res := public.retail_import(rows, true);
  if (res ->> 'created')::int <> 2 then raise exception 'commit created should be 2, got %', res ->> 'created'; end if;
  if (res ->> 'stocked')::int <> 2 then raise exception 'commit stocked should be 2, got %', res ->> 'stocked'; end if;
end $$;

-- product is sellable at SRP, linked to stock, priced right, branded, categorized
do $$
declare p record; v_stock numeric; v_cost numeric;
begin
  select pr.name, pr.brand, pr.price, pr.kind, pr.inventory_item_id, c.name as cat
    into p from public.products pr join public.categories c on c.id = pr.category_id
   where pr.name = 'Coke Mismo';
  if p.price <> 20 then raise exception 'Coke price (SRP) should be 20, got %', p.price; end if;
  if p.kind <> 'retail' then raise exception 'should be a retail product'; end if;
  if p.brand <> 'Coca-Cola' then raise exception 'brand not set, got %', p.brand; end if;
  if p.cat <> 'Convenience Store' then raise exception 'default category wrong: %', p.cat; end if;
  if p.inventory_item_id is null then raise exception 'retail product not linked to stock'; end if;

  select current_stock, avg_cost into v_stock, v_cost from public.inventory_items where id = p.inventory_item_id;
  if v_stock <> 24 then raise exception 'Coke stock should be 24, got %', v_stock; end if;
  if v_cost <> 12 then raise exception 'Coke cost should be 12, got %', v_cost; end if;
end $$;

-- re-import same SKU updates price, no duplicate product
do $$
declare res jsonb; v_count int; v_price numeric;
begin
  res := public.retail_import(jsonb_build_array(
    jsonb_build_object('name','Coke Mismo','brand','Coca-Cola','sku','RET-COKE',
      'quantity','0','cost','0','srp','22')), true);
  if (res ->> 'updated')::int <> 1 then raise exception 're-import should update 1, got %', res ->> 'updated'; end if;
  select count(*) into v_count from public.products where name = 'Coke Mismo';
  if v_count <> 1 then raise exception 'product duplicated on re-import: % rows', v_count; end if;
  select price into v_price from public.products where name = 'Coke Mismo';
  if v_price <> 22 then raise exception 'SRP update did not apply, got %', v_price; end if;
end $$;

-- permission: cashier denied
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f6', true);
do $$
begin
  perform public.retail_import(jsonb_build_array(
    jsonb_build_object('name','X','quantity','1','cost','1','srp','2')), true);
  raise exception 'cashier retail import must be denied';
exception when others then
  if sqlerrm like '%must be denied%' then raise; end if;
  if sqlerrm not like '%permission denied%' then raise exception 'unexpected: %', sqlerrm; end if;
end $$;

rollback;
