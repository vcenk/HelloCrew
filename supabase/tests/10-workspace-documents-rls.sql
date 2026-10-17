-- Local RLS check: run against a throwaway Postgres after 00-supabase-stubs.sql and all migrations.
-- Expected: CAS update succeeds once, stale/skip/spoof writes fail, bob and anon see nothing.
\set ON_ERROR_STOP 0
insert into auth.users values ('00000000-0000-0000-0000-00000000000a','alice@x.com'),('00000000-0000-0000-0000-00000000000b','bob@x.com');
select count(*) as tenants_after_signup from hc_tenants;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select tenant_id as alice_tenant from hc_memberships \gset
insert into hc_workspace_documents (tenant_id,key,document,updated_by) values (:'alice_tenant','knowledge','{"a":1}','00000000-0000-0000-0000-00000000000a');
-- CAS ok
update hc_workspace_documents set document='{"a":2}', version=2, updated_by=auth.uid() where tenant_id=:'alice_tenant' and key='knowledge' and version=1;
-- stale write (version mismatch in where) -> 0 rows
update hc_workspace_documents set document='{"a":3}', version=2, updated_by=auth.uid() where tenant_id=:'alice_tenant' and key='knowledge' and version=1;
-- skipping a version -> error
update hc_workspace_documents set document='{"a":4}', version=9, updated_by=auth.uid() where tenant_id=:'alice_tenant' and key='knowledge';
-- spoof updated_by -> error
update hc_workspace_documents set document='{"a":5}', version=3, updated_by='00000000-0000-0000-0000-00000000000b' where tenant_id=:'alice_tenant' and key='knowledge';
select version, document from hc_workspace_documents;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select count(*) as bob_sees from hc_workspace_documents;
update hc_workspace_documents set document='{"hack":1}', version=3, updated_by=auth.uid() where tenant_id=:'alice_tenant';
insert into hc_workspace_documents (tenant_id,key,document,updated_by) values (:'alice_tenant','workflows','{}','00000000-0000-0000-0000-00000000000b');
set role anon;
select count(*) from hc_workspace_documents;
reset role;
select version, document from hc_workspace_documents;
