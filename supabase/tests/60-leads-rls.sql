-- Local RLS check for leads.
\set ON_ERROR_STOP 1
insert into auth.users values
  ('00000000-0000-0000-0000-0000000000c9', 'ivy@x.com'),
  ('00000000-0000-0000-0000-0000000000d9', 'jack@x.com')
on conflict do nothing;
select tenant_id as ivy_tenant from hc_memberships where user_id = '00000000-0000-0000-0000-0000000000c9' \gset
-- Server creates the lead.
insert into hc_leads (tenant_id, id, name, phone, interest)
values (:'ivy_tenant', '60000000-0000-0000-0000-000000000001', 'Sam', '+1 604 555 0101', 'Balayage quote');
do $$ begin
  begin
    insert into hc_leads (tenant_id, name, interest) values ((select tenant_id from hc_leads limit 1), 'No contact', 'x');
    raise exception 'lead without contact accepted';
  exception when check_violation then null; end;
end $$;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c9';
update hc_leads set status = 'contacted';
do $$ begin
  if (select status from hc_leads) <> 'contacted' then raise exception 'owner update failed'; end if;
  begin
    update hc_leads set phone = '000';
    raise exception 'owner changed contact details';
  exception when insufficient_privilege then null; end;
  begin
    insert into hc_leads (tenant_id, name, phone, interest) values ((select tenant_id from hc_leads limit 1), 'Fake', '1', 'x');
    raise exception 'owner inserted a lead';
  exception when insufficient_privilege then null; end;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d9';
do $$ begin
  if (select count(*) from hc_leads) <> 0 then raise exception 'cross-tenant read'; end if;
end $$;
reset role;
select 'leads RLS ok' as result;
