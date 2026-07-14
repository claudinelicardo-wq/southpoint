-- 0011 Reporting functions.
--
-- Aggregations live in the database (not the browser) so every report is
-- derived from the same posted records and reconciles with source transactions.
-- All functions are security definer and permission-gated. Money reports
-- (COGS / profit) require reports.profit; sales reports require reports.sales.
--
-- Date parameters are timestamptz range bounds [p_from, p_to). Callers pass
-- Asia/Manila day boundaries.

-- --------------------------------------------------------------------------
-- Sales summary — the headline numbers for a period.
-- --------------------------------------------------------------------------
create or replace function public.report_sales_summary(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare
  v jsonb;
  v_gross numeric; v_disc numeric; v_tax numeric; v_svc numeric;
  v_total numeric; v_cogs numeric; v_count int; v_refunds numeric;
begin
  if not public.has_permission('reports.sales') then
    raise exception 'permission denied: reports.sales';
  end if;

  select coalesce(sum(subtotal), 0), coalesce(sum(discount_total), 0),
         coalesce(sum(tax_total), 0), coalesce(sum(service_charge), 0),
         coalesce(sum(total), 0), coalesce(sum(cogs_total), 0), count(*)
    into v_gross, v_disc, v_tax, v_svc, v_total, v_cogs, v_count
    from public.orders
   where status = 'completed'
     and completed_at >= p_from and completed_at < p_to;

  select coalesce(sum(amount), 0) into v_refunds
    from public.refunds
   where created_at >= p_from and created_at < p_to;

  v := jsonb_build_object(
    'gross_sales', v_gross,
    'discounts', v_disc,
    'refunds', v_refunds,
    'net_sales', v_gross - v_disc - v_refunds,
    'tax', v_tax,
    'service_charge', v_svc,
    'total_collected', v_total,
    'cogs', v_cogs,
    'gross_profit', (v_gross - v_disc - v_refunds) - v_cogs,
    'order_count', v_count,
    'avg_order_value', case when v_count > 0 then round(v_total / v_count, 2) else 0 end
  );
  return v;
end $$;

-- --------------------------------------------------------------------------
-- Sales breakdown by a chosen dimension. Returns (label, qty, amount, cogs).
-- qty/cogs are 0 for dimensions where they don't apply (e.g. payment_method).
-- --------------------------------------------------------------------------
create or replace function public.report_sales_breakdown(
  p_dim text, p_from timestamptz, p_to timestamptz
)
returns table (label text, qty numeric, amount numeric, cogs numeric)
language plpgsql security definer set search_path = public stable as $$
begin
  if not public.has_permission('reports.sales') then
    raise exception 'permission denied: reports.sales';
  end if;

  if p_dim = 'product' then
    return query
      select oi.product_name,
             sum(oi.qty)::numeric, sum(oi.line_total)::numeric, sum(oi.cost_total)::numeric
        from public.order_items oi
        join public.orders o on o.id = oi.order_id
       where o.status = 'completed' and o.completed_at >= p_from and o.completed_at < p_to
       group by oi.product_name
       order by 3 desc;

  elsif p_dim = 'category' then
    return query
      select coalesce(c.name, 'Uncategorized'),
             sum(oi.qty)::numeric, sum(oi.line_total)::numeric, sum(oi.cost_total)::numeric
        from public.order_items oi
        join public.orders o on o.id = oi.order_id
        left join public.products p on p.id = oi.product_id
        left join public.categories c on c.id = p.category_id
       where o.status = 'completed' and o.completed_at >= p_from and o.completed_at < p_to
       group by coalesce(c.name, 'Uncategorized')
       order by 3 desc;

  elsif p_dim = 'cashier' then
    return query
      select coalesce(pr.full_name, 'Unknown'),
             count(*)::numeric, sum(o.total)::numeric, sum(o.cogs_total)::numeric
        from public.orders o
        left join public.profiles pr on pr.id = o.created_by
       where o.status = 'completed' and o.completed_at >= p_from and o.completed_at < p_to
       group by coalesce(pr.full_name, 'Unknown')
       order by 3 desc;

  elsif p_dim = 'order_type' then
    return query
      select o.order_type::text,
             count(*)::numeric, sum(o.total)::numeric, sum(o.cogs_total)::numeric
        from public.orders o
       where o.status = 'completed' and o.completed_at >= p_from and o.completed_at < p_to
       group by o.order_type
       order by 3 desc;

  elsif p_dim = 'payment_method' then
    return query
      select pm.name,
             count(*)::numeric, sum(pay.amount)::numeric, 0::numeric
        from public.payments pay
        join public.payment_methods pm on pm.id = pay.method_id
       where pay.status = 'posted' and pay.created_at >= p_from and pay.created_at < p_to
       group by pm.name
       order by 3 desc;

  elsif p_dim = 'day' then
    return query
      select to_char(o.completed_at at time zone 'Asia/Manila', 'YYYY-MM-DD'),
             count(*)::numeric, sum(o.total)::numeric, sum(o.cogs_total)::numeric
        from public.orders o
       where o.status = 'completed' and o.completed_at >= p_from and o.completed_at < p_to
       group by 1 order by 1;

  elsif p_dim = 'hour' then
    return query
      select to_char(o.completed_at at time zone 'Asia/Manila', 'HH24:00'),
             count(*)::numeric, sum(o.total)::numeric, sum(o.cogs_total)::numeric
        from public.orders o
       where o.status = 'completed' and o.completed_at >= p_from and o.completed_at < p_to
       group by 1 order by 1;

  else
    raise exception 'unknown breakdown dimension: %', p_dim;
  end if;
end $$;

-- --------------------------------------------------------------------------
-- Estimated operating P&L. Requires profit permission (exposes COGS/margin).
-- --------------------------------------------------------------------------
create or replace function public.report_pnl(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare
  v_gross numeric; v_disc numeric; v_cogs numeric; v_refunds numeric;
  v_waste numeric; v_expenses numeric; v_net_sales numeric; v_gp numeric;
begin
  if not public.has_permission('reports.profit') then
    raise exception 'permission denied: reports.profit';
  end if;

  select coalesce(sum(subtotal), 0), coalesce(sum(discount_total), 0),
         coalesce(sum(cogs_total), 0)
    into v_gross, v_disc, v_cogs
    from public.orders
   where status = 'completed' and completed_at >= p_from and completed_at < p_to;

  select coalesce(sum(amount), 0) into v_refunds
    from public.refunds where created_at >= p_from and created_at < p_to;

  select coalesce(sum(cost), 0) into v_waste
    from public.waste_records
   where status = 'approved' and created_at >= p_from and created_at < p_to;

  select coalesce(sum(amount), 0) into v_expenses
    from public.expenses
   where status = 'approved'
     and expense_date >= (p_from at time zone 'Asia/Manila')::date
     and expense_date <  (p_to   at time zone 'Asia/Manila')::date;

  v_net_sales := v_gross - v_disc - v_refunds;
  v_gp := v_net_sales - v_cogs;

  return jsonb_build_object(
    'net_sales', v_net_sales,
    'cogs', v_cogs,
    'gross_profit', v_gp,
    'gross_margin_pct', case when v_net_sales > 0 then round(v_gp / v_net_sales * 100, 1) else 0 end,
    'waste_cost', v_waste,
    'operating_expenses', v_expenses,
    'estimated_net_profit', v_gp - v_waste - v_expenses
  );
end $$;

-- --------------------------------------------------------------------------
-- Current inventory valuation at weighted-average cost.
-- --------------------------------------------------------------------------
create or replace function public.report_inventory_valuation()
returns table (
  item_id uuid, name text, inventory_type text, base_unit text,
  qty numeric, unit_cost numeric, value numeric
)
language plpgsql security definer set search_path = public stable as $$
begin
  if not public.has_permission('inventory.view') then
    raise exception 'permission denied: inventory.view';
  end if;
  return query
    select i.id, i.name, i.inventory_type::text, i.base_unit,
           i.current_stock,
           case when i.avg_cost > 0 then i.avg_cost else i.latest_cost end,
           round(i.current_stock * case when i.avg_cost > 0 then i.avg_cost else i.latest_cost end, 2)
      from public.inventory_items i
     where i.archived_at is null
     order by value desc nulls last, i.name;
end $$;

grant execute on function public.report_sales_summary(timestamptz, timestamptz) to authenticated;
grant execute on function public.report_sales_breakdown(text, timestamptz, timestamptz) to authenticated;
grant execute on function public.report_pnl(timestamptz, timestamptz) to authenticated;
grant execute on function public.report_inventory_valuation() to authenticated;
