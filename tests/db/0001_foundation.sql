-- Phase 1 foundation tests. Runs inside one transaction and rolls back.
begin;

-- --- fixtures -------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000001', 'owner@test',   '{"full_name":"Olive Owner","role":"owner"}'),
  ('00000000-0000-0000-0000-000000000002', 'manager@test', '{"full_name":"Manny Manager","role":"manager"}'),
  ('00000000-0000-0000-0000-000000000003', 'cash@test',    '{"full_name":"Cassie Cashier","role":"cashier"}'),
  ('00000000-0000-0000-0000-000000000004', 'former@test',  '{"full_name":"Frank Former","role":"cashier","is_active":false}');

-- profile trigger created rows with the right roles
do $$ begin
  if (select count(*) from public.profiles) <> 4 then
    raise exception 'expected 4 auto-created profiles';
  end if;
  if (select role from public.profiles where id = '00000000-0000-0000-0000-000000000002') <> 'manager' then
    raise exception 'manager role not applied from metadata';
  end if;
  if (select is_active from public.profiles where id = '00000000-0000-0000-0000-000000000004') then
    raise exception 'inactive flag not applied from metadata';
  end if;
end $$;

-- --- permission matrix ----------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true); -- cashier

do $$ begin
  if not public.has_permission('pos.sell') then raise exception 'cashier should sell'; end if;
  if public.has_permission('reports.profit') then raise exception 'cashier must not see profit reports'; end if;
  if public.has_permission('staff.manage') then raise exception 'cashier must not manage staff'; end if;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true); -- owner
do $$ begin
  if not public.has_permission('anything.at.all') then
    raise exception 'owner must implicitly hold every permission';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true); -- inactive
do $$ begin
  if public.has_permission('pos.sell') then
    raise exception 'inactive staff must have no permissions';
  end if;
  if public.is_active_staff() then raise exception 'inactive staff is not active'; end if;
end $$;

-- --- settings gating --------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true); -- cashier
do $$ begin
  perform public.set_setting('receipt', '{"width_mm":80}'::jsonb);
  raise exception 'cashier should not be able to write settings';
exception when others then
  if sqlerrm like '%should not be able%' then raise; end if;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true); -- manager
select public.set_setting('receipt', '{"width_mm":80,"footer":"Salamat!","show_loyalty_points":true}'::jsonb);
do $$ begin
  if (public.get_setting('receipt') ->> 'width_mm')::int <> 80 then
    raise exception 'manager write to non-sensitive setting failed';
  end if;
  begin
    perform public.set_setting('tax', '{"vat_registered":true}'::jsonb);
    raise exception 'manager must not write sensitive settings';
  exception when others then
    if sqlerrm like '%must not write%' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true); -- owner
select public.set_setting('tax',
  '{"vat_registered":false,"pricing_mode":"tax_inclusive","vat_rate":0.12,"service_charge_rate":0,"sc_pwd_discount_rate":0.20,"sc_pwd_vat_exempt":true}'::jsonb);

-- --- audit log -------------------------------------------------------------
reset role;
do $$ begin
  if (select count(*) from public.audit_logs where action = 'settings.update') < 2 then
    raise exception 'settings updates must be audited';
  end if;
  begin
    update public.audit_logs set reason = 'tampered' where true;
    raise exception 'audit rows must be immutable (update)';
  exception when others then
    if sqlerrm like '%must be immutable%' then raise; end if;
  end;
  begin
    delete from public.audit_logs where true;
    raise exception 'audit rows must be immutable (delete)';
  exception when others then
    if sqlerrm like '%must be immutable%' then raise; end if;
  end;
end $$;

-- --- staff management --------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true); -- manager
do $$ begin
  perform public.staff_update('00000000-0000-0000-0000-000000000003', 'X', 'manager', true);
  raise exception 'manager must not manage staff';
exception when others then
  if sqlerrm like '%must not manage%' then raise; end if;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true); -- owner
select public.staff_update('00000000-0000-0000-0000-000000000003', 'Cassie C.', 'inventory', true, 'promoted');
do $$ begin
  if (select role from public.profiles where id = '00000000-0000-0000-0000-000000000003') <> 'inventory' then
    raise exception 'owner role change failed';
  end if;
  begin
    perform public.staff_update('00000000-0000-0000-0000-000000000001', 'Olive', 'cashier', true);
    raise exception 'owner must not demote self';
  exception when others then
    if sqlerrm like '%must not demote self%' then raise; end if;
  end;
end $$;

-- --- doc numbers -------------------------------------------------------------
reset role;
do $$ begin
  if public.next_doc_number('order') <> 'SP-000001' then raise exception 'doc number format'; end if;
  if public.next_doc_number('order') <> 'SP-000002' then raise exception 'doc number increment'; end if;
end $$;

-- authenticated role must NOT be able to call next_doc_number directly
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
do $$ begin
  perform public.next_doc_number('order');
  raise exception 'next_doc_number must be RPC-internal';
exception when insufficient_privilege then null;
end $$;

-- --- RLS: inactive user sees only self ---------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', true); -- inactive
do $$ begin
  if (select count(*) from public.profiles) <> 1 then
    raise exception 'inactive user should only see own profile';
  end if;
end $$;

rollback;
select 'foundation ok' as result;
