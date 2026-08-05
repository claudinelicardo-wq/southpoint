-- 0012 Inventory CSV import.
--
-- A single security-definer RPC that validates a batch of rows and, when
-- committed, upserts inventory items (by SKU) and posts opening stock through
-- add_stock (so the ledger and weighted-average cost stay correct). Runs in one
-- transaction; each row's write is guarded by a savepoint so one bad row is
-- reported and skipped instead of failing the whole import.
--
-- Two-phase by design: call with p_commit=false for a dry-run preview (returns
-- per-row validation, writes nothing), then p_commit=true to apply.

create or replace function public.inventory_import(p_rows jsonb, p_commit boolean default false)
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
  v_name text; v_sku text; v_barcode text; v_type text; v_unit text; v_category text;
  v_reorder numeric; v_target numeric; v_purchase_label text; v_purchase_factor numeric;
  v_location text; v_track boolean; v_opening numeric; v_cost numeric;
  v_existing uuid; v_item uuid; v_err text;
  v_types text[] := array['ingredient','packaging','retail','prepared','supply'];
begin
  if not (public.has_permission('inventory.adjust') or public.has_permission('catalog.manage')) then
    raise exception 'permission denied: inventory import needs inventory.adjust or catalog.manage';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be a JSON array';
  end if;

  for r in select * from jsonb_array_elements(p_rows)
  loop
    idx := idx + 1;
    v_err := null;

    -- ---- parse (numbers tolerated as strings) --------------------------
    v_name := btrim(coalesce(r->>'name',''));
    v_sku := nullif(btrim(coalesce(r->>'sku','')), '');
    v_barcode := nullif(btrim(coalesce(r->>'barcode','')), '');
    v_type := lower(btrim(coalesce(r->>'inventory_type','')));
    v_unit := lower(btrim(coalesce(r->>'base_unit','')));
    v_category := btrim(coalesce(r->>'category',''));
    v_purchase_label := btrim(coalesce(r->>'purchase_unit_label',''));
    v_location := btrim(coalesce(r->>'storage_location',''));
    v_track := lower(coalesce(r->>'track_expiry','')) in ('true','yes','y','1');

    begin
      v_reorder := coalesce(nullif(btrim(coalesce(r->>'reorder_level','')), '')::numeric, 0);
      v_target := coalesce(nullif(btrim(coalesce(r->>'target_level','')), '')::numeric, 0);
      v_purchase_factor := coalesce(nullif(btrim(coalesce(r->>'purchase_to_base_factor','')), '')::numeric, 1);
      v_opening := coalesce(nullif(btrim(coalesce(r->>'opening_stock','')), '')::numeric, 0);
      v_cost := coalesce(nullif(btrim(coalesce(r->>'unit_cost','')), '')::numeric, 0);
    exception when others then
      v_err := 'a numeric column is not a valid number';
    end;

    -- ---- validate ------------------------------------------------------
    if v_err is null then
      if v_name = '' then v_err := 'name is required';
      elsif not (v_type = any(v_types)) then
        v_err := format('inventory_type "%s" must be one of ingredient/packaging/retail/prepared/supply', v_type);
      elsif not exists (select 1 from public.units where code = v_unit) then
        v_err := format('base_unit "%s" is not a known unit', v_unit);
      elsif v_purchase_factor <= 0 then v_err := 'purchase_to_base_factor must be > 0';
      elsif v_reorder < 0 or v_target < 0 or v_opening < 0 or v_cost < 0 then
        v_err := 'quantities and cost cannot be negative';
      end if;
    end if;

    if v_err is not null then
      errors := errors || jsonb_build_object('row', idx, 'name', v_name, 'error', v_err);
      continue;
    end if;
    v_valid := v_valid + 1;

    if not p_commit then continue; end if;  -- dry-run: validate only

    -- ---- write (savepoint per row) -------------------------------------
    begin
      v_existing := null;
      if v_sku is not null then
        select id into v_existing from public.inventory_items where sku = v_sku;
      end if;

      if v_existing is not null then
        update public.inventory_items set
          name = v_name, inventory_type = v_type::inventory_type, category = v_category,
          barcode = v_barcode, base_unit = v_unit, purchase_unit_label = v_purchase_label,
          purchase_to_base_factor = v_purchase_factor, reorder_level = v_reorder,
          target_level = v_target, storage_location = v_location, track_expiry = v_track,
          archived_at = null
        where id = v_existing;
        v_item := v_existing;
        v_updated := v_updated + 1;
      else
        insert into public.inventory_items
          (name, sku, barcode, inventory_type, category, base_unit, purchase_unit_label,
           purchase_to_base_factor, reorder_level, target_level, storage_location, track_expiry)
        values
          (v_name, v_sku, v_barcode, v_type::inventory_type, v_category, v_unit, v_purchase_label,
           v_purchase_factor, v_reorder, v_target, v_location, v_track)
        returning id into v_item;
        v_created := v_created + 1;
      end if;

      if v_opening > 0 then
        perform public.add_stock(v_item, v_opening, v_cost, 'opening_balance',
          'import', null, null, null, 'CSV import');
        v_stocked := v_stocked + 1;
      end if;
    exception when others then
      errors := errors || jsonb_build_object('row', idx, 'name', v_name, 'error', sqlerrm);
    end;
  end loop;

  if p_commit and (v_created > 0 or v_updated > 0) then
    perform public.log_audit('inventory.import', 'inventory_items', null, null,
      jsonb_build_object('created', v_created, 'updated', v_updated, 'stocked', v_stocked),
      'CSV import');
  end if;

  return jsonb_build_object(
    'committed', p_commit,
    'total', idx,
    'valid', v_valid,
    'created', v_created,
    'updated', v_updated,
    'stocked', v_stocked,
    'error_count', jsonb_array_length(errors),
    'errors', errors
  );
end $$;

grant execute on function public.inventory_import(jsonb, boolean) to authenticated;
