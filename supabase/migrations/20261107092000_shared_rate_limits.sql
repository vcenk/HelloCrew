-- A rate limit that means something on serverless.
--
-- lib/server/rate-limit.ts keeps counters in one process's memory and says so
-- in its first comment. On Vercel each instance has its own, so the real
-- ceiling is roughly instances x limit, and it rises exactly when traffic
-- does. It slows a single clumsy client and does nothing about a determined
-- one.
--
-- Postgres is already here and already the authoritative store for spending,
-- so the shared counter goes here rather than into a new paid service.
--
-- This table holds no tenant data: the limiter runs before a request is
-- resolved to a workspace, and its rows are counters keyed by a scope, a
-- client fingerprint and an installation id. There is nothing in it to leak
-- between workspaces, which is why it joins hc_webhook_events in the
-- tenant-key exemption in tests/migrations-rls.test.ts.
--
-- Forward recovery: creates one table and one function. Re-running is safe.
-- Dropping the table degrades to fail-open, which is the documented
-- behaviour, not an outage.

create table if not exists public.hc_rate_limits (
  -- scope:fingerprint:installation, built by the caller and bounded there.
  bucket text primary key check (char_length(bucket) between 1 and 200),
  window_started_at timestamptz not null default now(),
  hits integer not null default 0 check (hits >= 0)
);

alter table public.hc_rate_limits enable row level security;
alter table public.hc_rate_limits force row level security;
-- No policies on purpose: nothing but the service role may read or write
-- counters, and the service role bypasses RLS.
revoke all on public.hc_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.hc_rate_limits to service_role;

create index if not exists hc_rate_limits_stale
  on public.hc_rate_limits (window_started_at);

/*
 * Count one request against a bucket and say whether it may proceed.
 *
 * A fixed window, like the in-memory version it replaces, so behaviour at
 * the boundary is unchanged and only the sharing is new. The insert and the
 * increment are one statement, so concurrent requests cannot both read the
 * same count and both decide they are under the limit.
 *
 * Returns the hits so far and the seconds until the window resets; the
 * caller decides what to do with them.
 */
create or replace function public.hc_rate_limit_hit(
  p_bucket text,
  p_window_seconds integer
)
returns table (hits integer, reset_in_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_bucket text := left(p_bucket, 200);
begin
  insert into public.hc_rate_limits (bucket, window_started_at, hits)
  values (v_bucket, v_now, 1)
  on conflict (bucket) do update
    set
      -- Expired window: start a new one rather than carrying the old count.
      window_started_at = case
        when public.hc_rate_limits.window_started_at
             + make_interval(secs => p_window_seconds) <= v_now
        then v_now
        else public.hc_rate_limits.window_started_at
      end,
      hits = case
        when public.hc_rate_limits.window_started_at
             + make_interval(secs => p_window_seconds) <= v_now
        then 1
        else public.hc_rate_limits.hits + 1
      end
  returning
    public.hc_rate_limits.hits,
    greatest(
      0,
      ceil(extract(epoch from (
        public.hc_rate_limits.window_started_at
        + make_interval(secs => p_window_seconds) - v_now
      )))::integer
    )
  into hits, reset_in_seconds;
  return next;
end;
$$;

/* Housekeeping. Counters outlive their window by nothing of value. */
create or replace function public.hc_prune_rate_limits(p_older_than_seconds integer default 3600)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows integer;
begin
  delete from public.hc_rate_limits
   where window_started_at < now() - make_interval(secs => p_older_than_seconds);
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function public.hc_rate_limit_hit(text, integer) from public, anon, authenticated;
revoke all on function public.hc_prune_rate_limits(integer) from public, anon, authenticated;
grant execute on function public.hc_rate_limit_hit(text, integer) to service_role;
grant execute on function public.hc_prune_rate_limits(integer) to service_role;

comment on table public.hc_rate_limits is
  'Shared fixed-window counters for public endpoints. Holds no tenant data. The usage ledger, not this, is the authoritative spending control.';
