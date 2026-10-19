-- Local RLS check for knowledge files and full-text search.
\set ON_ERROR_STOP 1
insert into auth.users values
  ('00000000-0000-0000-0000-0000000000a7', 'gina@x.com'),
  ('00000000-0000-0000-0000-0000000000b7', 'hank@x.com')
on conflict do nothing;
select tenant_id as gina_tenant from hc_memberships where user_id = '00000000-0000-0000-0000-0000000000a7' \gset
select set_config('hc.gina', :'gina_tenant', false);
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a7';
insert into hc_knowledge_files (tenant_id, id, title, status, created_by)
values (:'gina_tenant', '50000000-0000-0000-0000-000000000001', 'Price list', 'review', auth.uid());
insert into hc_knowledge_file_chunks (tenant_id, file_id, ordinal, content)
values (:'gina_tenant', '50000000-0000-0000-0000-000000000001', 0, 'Balayage with a senior stylist costs 180 dollars'),
       (:'gina_tenant', '50000000-0000-0000-0000-000000000001', 1, 'Parking is free behind the salon');
do $$ begin
  -- Not searchable until the owner allows it.
  if (select count(*) from hc_search_file_chunks(current_setting('hc.gina')::uuid, 'balayage | parking', 4)) <> 0
  then raise exception 'searched an unapproved file'; end if;
end $$;
update hc_knowledge_files set status = 'ready', use_for_answers = true;
do $$ begin
  if (select content from hc_search_file_chunks(current_setting('hc.gina')::uuid, 'balayage | senior', 4) limit 1)
     not like 'Balayage%' then raise exception 'search failed'; end if;
  begin
    update hc_knowledge_files set storage_path = 'other/tenant/file';
    raise exception 'storage path changed by owner';
  exception when insufficient_privilege then null; end;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b7';
do $$ begin
  if (select count(*) from hc_knowledge_files) + (select count(*) from hc_knowledge_file_chunks) <> 0
  then raise exception 'cross-tenant read'; end if;
  if (select count(*) from hc_search_file_chunks(current_setting('hc.gina')::uuid, 'balayage', 4)) <> 0
  then raise exception 'cross-tenant search'; end if;
  begin
    insert into hc_knowledge_file_chunks (tenant_id, file_id, ordinal, content)
    values (current_setting('hc.gina')::uuid, '50000000-0000-0000-0000-000000000001', 9, 'injected');
    raise exception 'cross-tenant chunk insert';
  exception when insufficient_privilege then null; end;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a7';
delete from hc_knowledge_files;
do $$ begin
  if (select count(*) from hc_knowledge_file_chunks) <> 0 then raise exception 'chunks left behind'; end if;
end $$;
reset role;
select 'knowledge files RLS ok' as result;
