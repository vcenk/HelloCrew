-- Local RLS check for website chat installations.
\set ON_ERROR_STOP 1
insert into auth.users values
  ('00000000-0000-0000-0000-0000000000e1', 'erin@x.com'),
  ('00000000-0000-0000-0000-0000000000f1', 'frank@x.com')
on conflict do nothing;
select tenant_id as erin_tenant from hc_memberships where user_id = '00000000-0000-0000-0000-0000000000e1' \gset
select set_config('hc.erin', :'erin_tenant', false);
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e1';
insert into hc_widget_installations (tenant_id, public_id, allowed_origins, created_by)
values (:'erin_tenant', 'w-abcdefghij0123456789', '{https://erin.example}', auth.uid());
update hc_widget_installations set allowed_origins = '{https://erin.example,https://www.erin.example}', enabled = false;
do $$ begin
  begin
    update hc_widget_installations set public_id = 'w-zzzzzzzzzzzzzzzzzzzz';
    raise exception 'public id changed by owner';
  exception when insufficient_privilege then null; end;
  begin
    insert into hc_widget_installations (tenant_id, public_id, created_by)
    values (current_setting('hc.erin')::uuid, 'w-bad', auth.uid());
    raise exception 'bad public id accepted';
  exception when check_violation then null; end;
  begin
    perform visitor_token_hash from hc_conversations;
    raise exception 'visitor token readable';
  exception when insufficient_privilege then null; end;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f1';
do $$ begin
  if (select count(*) from hc_widget_installations) <> 0 then raise exception 'cross-tenant read'; end if;
  update hc_widget_installations set enabled = true;
  if (select count(*) from hc_widget_installations) <> 0 then raise exception 'unexpected'; end if;
end $$;
reset role;
do $$ begin
  if (select enabled from hc_widget_installations where public_id = 'w-abcdefghij0123456789') then
    raise exception 'cross-tenant update applied'; end if;
end $$;
select 'widget installations RLS ok' as result;
