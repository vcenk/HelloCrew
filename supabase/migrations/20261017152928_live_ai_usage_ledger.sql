-- Live AI spend controls (Phase 2).
-- Limits and the usage ledger are server-owned: only the service role (used by
-- HelloCrew's server code, never the browser) can read or change them. A
-- signed-in owner cannot raise their own budget or erase spend.

create table public.hc_tenant_limits (
  tenant_id uuid primary key references public.hc_tenants(id) on delete cascade,
  live_ai_enabled boolean not null default false,
  monthly_budget_micro_usd bigint not null default 5000000
    check (monthly_budget_micro_usd between 0 and 1000000000),
  updated_at timestamptz not null default now()
);
alter table public.hc_tenant_limits enable row level security;
alter table public.hc_tenant_limits force row level security;
revoke all on public.hc_tenant_limits from public, anon, authenticated;

insert into public.hc_tenant_limits (tenant_id)
select id from public.hc_tenants
on conflict do nothing;

-- New tenants get default limits.
create or replace function private.handle_new_tenant_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.hc_tenant_limits (tenant_id) values (new.id)
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function private.handle_new_tenant_limits() from public;
create trigger hc_tenants_default_limits
after insert on public.hc_tenants
for each row execute function private.handle_new_tenant_limits();

create index if not exists hc_usage_reservations_month_idx
  on public.hc_usage_reservations (tenant_id, created_at);

-- Atomically reserve the worst-case cost of one model turn against both the
-- tenant's monthly budget and the platform-wide cap. Returns null when either
-- would be exceeded or live AI is off for the tenant. Settled rows count at
-- their actual cost; reserved/uncertain rows count at the reserved amount.
create or replace function public.hc_reserve_usage(
  p_tenant_id uuid,
  p_request_id text,
  p_worst_case_micro_usd bigint,
  p_platform_cap_micro_usd bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  limits public.hc_tenant_limits;
  month_start timestamptz := date_trunc('month', now());
  tenant_spend bigint;
  platform_spend bigint;
  reservation uuid;
begin
  if p_worst_case_micro_usd < 0 or p_worst_case_micro_usd > 10000000 then
    raise exception 'invalid reservation amount';
  end if;
  -- Serialize reservations platform-wide so concurrent turns cannot overspend.
  perform pg_advisory_xact_lock(hashtext('hc_usage_ledger'));
  select * into limits from public.hc_tenant_limits
  where tenant_id = p_tenant_id;
  if not found or not limits.live_ai_enabled then
    return null;
  end if;
  select coalesce(sum(coalesce(settled_micro_usd, reserved_micro_usd)), 0)
    into tenant_spend
  from public.hc_usage_reservations
  where tenant_id = p_tenant_id and created_at >= month_start;
  select coalesce(sum(coalesce(settled_micro_usd, reserved_micro_usd)), 0)
    into platform_spend
  from public.hc_usage_reservations
  where created_at >= month_start;
  if tenant_spend + p_worst_case_micro_usd > limits.monthly_budget_micro_usd
     or platform_spend + p_worst_case_micro_usd > p_platform_cap_micro_usd then
    return null;
  end if;
  insert into public.hc_usage_reservations
    (tenant_id, request_id, reserved_micro_usd, status)
  values (p_tenant_id, p_request_id, p_worst_case_micro_usd, 'reserved')
  returning id into reservation;
  return reservation;
end;
$$;

-- Settle a reservation with the measured cost (never above the reservation),
-- or mark it uncertain so the full reserved amount stays charged.
create or replace function public.hc_settle_usage(
  p_tenant_id uuid,
  p_reservation_id uuid,
  p_actual_micro_usd bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.hc_usage_reservations
  set settled_micro_usd = case
        when p_actual_micro_usd is null then null
        else least(greatest(p_actual_micro_usd, 0), reserved_micro_usd)
      end,
      status = case when p_actual_micro_usd is null then 'uncertain' else 'settled' end
  where tenant_id = p_tenant_id and id = p_reservation_id and status = 'reserved';
end;
$$;

-- Month-to-date spend for one tenant (micro-USD), for the dashboard meter.
create or replace function public.hc_month_spend(p_tenant_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(coalesce(settled_micro_usd, reserved_micro_usd)), 0)::bigint
  from public.hc_usage_reservations
  where tenant_id = p_tenant_id and created_at >= date_trunc('month', now());
$$;

revoke all on function public.hc_reserve_usage(uuid, text, bigint, bigint) from public, anon, authenticated;
revoke all on function public.hc_settle_usage(uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function public.hc_month_spend(uuid) from public, anon, authenticated;
grant execute on function public.hc_reserve_usage(uuid, text, bigint, bigint) to service_role;
grant execute on function public.hc_settle_usage(uuid, uuid, bigint) to service_role;
grant execute on function public.hc_month_spend(uuid) to service_role;
grant select, insert, update on public.hc_tenant_limits to service_role;
grant select, insert, update on public.hc_usage_reservations to service_role;
