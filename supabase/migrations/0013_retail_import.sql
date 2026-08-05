-- 0013 Brand field + retail-product CSV import.
--
-- Convenience-store owners think in "Product, Brand, Quantity, Cost, SRP", not
-- inventory internals. This adds a brand field and a retail_import RPC where each
-- row becomes a POS-ready retail product (priced at SRP) backed by a stock item
-- (opening Quantity at Cost). Upserts by SKU, or by name+brand when no SKU, so
-- re-imports update in place. Dry-run (p_commit=false) validates without writing.

alter table public.products add column if not exists brand text not null default '';
alter table public.inventory_items add column if not exists brand text not null default '';

create or replace function public.retail_import(p_rows jsonb, p_commit boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  idx int := 0;
  v_created int := 0;
  v_updated int := 0;
  v_stocked int := 0;
  v_valid int := 0;
  errors jsonb := '[]'::jsonb;
  v_name text; v_brand text; v_sku text; v_barcode text; v_cat_name text;
  v_qty numeric; v_cost numeric; v_srp numeric;
  v_cat uuid; v_item uuid; v_prod uuid; v_existing uuid; v_err text;
begin
  if not (public.has_permission('catalog.manage') or public.has_permission('inventory.adjust')) then
    raise exception 'permission denied: retail import needs catalog.manage or inventory.adjust';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be a JSON array'; end if;

  for r in select * from jsonb_array_elements(p_rows)
  loop
    idx := idx + 1;
    v_err := null;
    v_name := btrim(coalesce(r->>'name',''));
    v_brand := btrim(coalesce(r->>'brand',''));
    v_sku := nullif(btrim(coalesce(r->>'sku','')), '');
    v_barcode := nullif(btrim(coalesce(r->>'barcode','')), '');
    v_cat_name := nullif(btrim(coalesce(r->>'category','')), '');

    begin
      v_qty := coalesce(nullif(btrim(coalesce(r->>'quantity','')), '')::numeric, 0);
      v_cost := coalesce(nullif(btrim(coalesce(r->>'cost','')), '')::numeric, 0);
      v_srp := coalesce(nullif(btrim(coalesce(r->>'srp','')), '')::numeric, 0);
    exception when others then
      v_err := 'Quantity, Cost, or SRP is not a valid number';
    end;

    if v_err is null then
      if v_name = '' then v_err := 'Product Name is required';
      elsif v_qty < 0 or v_cost < 0 or v_srp < 0 then
        v_err := 'Quantity, Cost, and SRP cannot be negative';
      end if;
    end if;

    if v_err is not null then
      errors := errors || jsonb_build_object('row', idx, 'name', v_name, 'error', v_err);
      continue;
    end if;
    v_valid := v_valid + 1;
    if not p_commit then continue; end if;

    begin
      -- category (defaults to "Convenience Store")
      v_cat_name := coalesce(v_cat_name, 'Convenience Store');
      insert into public.categories (name) values (v_cat_name) on conflict (name) do nothing;
      select id into v_cat from public.categories where name = v_cat_name;

      -- stock item: match by SKU, else by name+brand among retail items
      v_existing := null;
      if v_sku is not null then
        select id into v_existing from public.inventory_items where sku = v_sku;
      else
        select id into v_existing from public.inventory_items
         where inventory_type = 'retail' and lower(name) = lower(v_name)
           and lower(brand) = lower(v_brand) and archived_at is null
         limit 1;
      end if;

      if v_existing is not null then
        update public.inventory_items set
          name = v_name, brand = v_brand,
          barcode = coalesce(v_barcode, barcode),
          inventory_type = 'retail', base_unit = 'pc', archived_at = null
        where id = v_existing;
        v_item := v_existing;
      else
        insert into public.inventory_items (name, brand, sku, barcode, inventory_type, base_unit)
        values (v_name, v_brand, v_sku, v_barcode, 'retail', 'pc')
        returning id into v_item;
      end if;

      -- sellable product linked to that stock item
      select id into v_prod from public.products
       where inventory_item_id = v_item and kind = 'retail' limit 1;
      if v_prod is not null then
        update public.products set
          name = v_name, brand = v_brand, price = v_srp,
          category_id = v_cat, archived_at = null
        where id = v_prod;
        v_updated := v_updated + 1;
      else
        insert into public.products (kind, name, brand, category_id, price, inventory_item_id)
        values ('retail', v_name, v_brand, v_cat, v_srp, v_item)
        returning id into v_prod;
        v_created := v_created + 1;
      end if;

      -- opening stock at cost
      if v_qty > 0 then
        perform public.add_stock(v_item, v_qty, v_cost, 'opening_balance',
          'import', null, null, null, 'CSV retail import');
        v_stocked := v_stocked + 1;
      end if;
    exception when others then
      errors := errors || jsonb_build_object('row', idx, 'name', v_name, 'error', sqlerrm);
    end;
  end loop;

  if p_commit and (v_created > 0 or v_updated > 0) then
    perform public.log_audit('retail.import', 'products', null, null,
      jsonb_build_object('created', v_created, 'updated', v_updated, 'stocked', v_stocked),
      'CSV retail import');
  end if;

  return jsonb_build_object(
    'committed', p_commit, 'total', idx, 'valid', v_valid,
    'created', v_created, 'updated', v_updated, 'stocked', v_stocked,
    'error_count', jsonb_array_length(errors), 'errors', errors
  );
end $$;

grant execute on function public.retail_import(jsonb, boolean) to authenticated;
