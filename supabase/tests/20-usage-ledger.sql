-- Local check for the live AI usage ledger. Run after 00-supabase-stubs.sql and all migrations.
-- Expected: off => null; over budget => null; settle frees headroom; settle capped at reservation;
-- platform cap enforced; authenticated role denied; new tenants get a limits row.
\set ON_ERROR_STOP 0
insert into auth.users values (gen_random_uuid(),'ledger@x.com');
select id as t from hc_tenants order by created_at desc limit 1 \gset
select live_ai_enabled, monthly_budget_micro_usd from hc_tenant_limits where tenant_id=:'t';
select hc_reserve_usage(:'t','r0',1000, 20000000) is null as off_returns_null;
update hc_tenant_limits set live_ai_enabled=true, monthly_budget_micro_usd=3000 where tenant_id=:'t';
select hc_reserve_usage(:'t','r1',2000, 20000000) as res1 \gset
select hc_reserve_usage(:'t','r2',2000, 20000000) is null as over_budget_null;
select hc_settle_usage(:'t', :'res1', 500);
select hc_month_spend(:'t') as spend_after_settle;
select hc_reserve_usage(:'t','r3',2000, 20000000) is not null as fits_after_settle;
select hc_reserve_usage(:'t','r4',10, 2500) is null as platform_cap_null;
select hc_settle_usage(:'t', :'res1', 99999);
select settled_micro_usd as still_500 from hc_usage_reservations where id=:'res1';
set role authenticated;
select hc_reserve_usage(:'t','x',1,1);
select * from hc_tenant_limits;
reset role;
