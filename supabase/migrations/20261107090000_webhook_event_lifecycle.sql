-- A webhook event is not "handled" the moment it arrives.
--
-- hc_webhook_events used to hold (provider, event_id, received_at) and the
-- inbound handler inserted the row before storing the conversation, running
-- the model and delivering the reply. The route had already answered 200 from
-- inside after(), so any later failure was permanent: the provider's retry
-- carried the same event id, the insert conflicted, and the message was
-- dropped with nothing but a log line. after() also runs under waitUntil and
-- is bounded by maxDuration, so the work can simply be cut off partway.
--
-- This gives the row a lifecycle instead, so an attempt can fail and be
-- retried, and two workers cannot take the same event.
--
-- Forward recovery: additive only. Existing rows become 'completed', which is
-- the truthful reading of the old schema — a row existed only because the
-- handler had started, and the old code never retried either way. Re-running
-- this file is safe; every statement is guarded.

alter table public.hc_webhook_events
  add column if not exists status text not null default 'received',
  add column if not exists attempts integer not null default 0,
  -- Held while one worker is processing. A worker that dies leaves this in
  -- the past, which is what makes the event reclaimable rather than stuck.
  add column if not exists locked_until timestamptz,
  -- Bounded, and deliberately not the message. A failure reason may name the
  -- step and the provider's status; it must never carry an access token, a
  -- customer's words, or anything else only the customer should see.
  add column if not exists last_error text,
  add column if not exists completed_at timestamptz,
  -- The parsed event, kept only while the work is unfinished.
  --
  -- Needed because the route answers 200 before processing, so the provider
  -- never retries and there is nothing else to replay from. This does mean a
  -- customer's message sits here briefly, in a table with no tenant column.
  -- The protections are that the table is service-role only with forced RLS
  -- and no policies, that hc_complete_webhook_event nulls this the moment the
  -- work succeeds, and that the existing cron deletes rows after seven days.
  -- It is a real exposure, bounded deliberately; do not widen it by keeping
  -- payloads on completed rows.
  add column if not exists payload jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'hc_webhook_events_status_known'
  ) then
    alter table public.hc_webhook_events
      add constraint hc_webhook_events_status_known
      check (status in ('received', 'processing', 'completed', 'failed', 'retryable'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'hc_webhook_events_error_bounded'
  ) then
    alter table public.hc_webhook_events
      add constraint hc_webhook_events_error_bounded
      check (last_error is null or char_length(last_error) <= 300);
  end if;
end
$$;

-- Rows written before this migration were only ever created on the way in and
-- were never retried, so calling them completed changes no behaviour.
update public.hc_webhook_events
   set status = 'completed', completed_at = coalesce(completed_at, received_at)
 where status = 'received' and completed_at is null;

-- The sweep query: what is still owed work.
create index if not exists hc_webhook_events_unfinished
  on public.hc_webhook_events (locked_until)
  where status in ('received', 'processing', 'failed', 'retryable');

/*
 * Take ownership of one event, or report why not.
 *
 * Returns 'claimed' when the caller now owns it, 'completed' when the work is
 * already done and must not be repeated, and 'locked' when another worker
 * holds an unexpired lease. The insert and the update are each atomic, so two
 * workers racing on the same event id cannot both be told 'claimed'.
 */
create or replace function public.hc_claim_webhook_event(
  p_provider text,
  p_event_id text,
  p_lease_seconds integer default 120
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_rows integer;
  v_status text;
begin
  insert into public.hc_webhook_events (provider, event_id, status, attempts, locked_until)
  values (
    p_provider, left(p_event_id, 300), 'processing', 1,
    v_now + make_interval(secs => p_lease_seconds)
  )
  on conflict (provider, event_id) do nothing;
  if found then
    return 'claimed';
  end if;

  -- Not new. Take it only if nobody holds a live lease on it. 'processing' is
  -- in this list on purpose: a worker that died mid-event leaves the row that
  -- way, and an expired lease is exactly how we find out.
  update public.hc_webhook_events
     set status = 'processing',
         attempts = attempts + 1,
         locked_until = v_now + make_interval(secs => p_lease_seconds),
         last_error = null
   where provider = p_provider
     and event_id = left(p_event_id, 300)
     and status in ('received', 'processing', 'failed', 'retryable')
     and (locked_until is null or locked_until < v_now);
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    return 'claimed';
  end if;

  select status into v_status
    from public.hc_webhook_events
   where provider = p_provider and event_id = left(p_event_id, 300);
  if v_status = 'completed' then
    return 'completed';
  end if;
  return 'locked';
end;
$$;

/* The work finished. Nothing may process this event again. */
create or replace function public.hc_complete_webhook_event(
  p_provider text,
  p_event_id text
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.hc_webhook_events
     set status = 'completed',
         completed_at = now(),
         locked_until = null,
         last_error = null,
         -- The reason to hold a customer's message is gone the moment the
         -- work succeeds, so neither is the message.
         payload = null
   where provider = p_provider and event_id = left(p_event_id, 300);
$$;

/*
 * The attempt failed. p_retryable decides whether the provider's next
 * delivery is allowed to pick it up; both states release the lease, because a
 * held lease on a failed event is just a stuck event.
 */
create or replace function public.hc_fail_webhook_event(
  p_provider text,
  p_event_id text,
  p_reason text,
  p_retryable boolean default true
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.hc_webhook_events
     set status = case when p_retryable then 'retryable' else 'failed' end,
         locked_until = null,
         last_error = left(coalesce(p_reason, 'unknown'), 300)
   where provider = p_provider and event_id = left(p_event_id, 300);
$$;

/*
 * Record that a delivery arrived, before anything is done with it.
 *
 * Runs inside the request, before the 200, so an invocation that is cut off
 * during after() still leaves something for the sweeper to find. Existing
 * rows are left alone: a retry of an event already completed must not
 * resurrect it, and one already in flight must not lose its lease.
 */
create or replace function public.hc_receive_webhook_event(
  p_provider text,
  p_event_id text,
  p_payload jsonb
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.hc_webhook_events (provider, event_id, status, payload)
  values (p_provider, left(p_event_id, 300), 'received', p_payload)
  on conflict (provider, event_id) do nothing;
$$;

/*
 * Deliveries that were accepted and never finished.
 *
 * Only rows whose lease has expired, so an event actively being processed is
 * never handed to a second worker.
 */
create or replace function public.hc_stuck_webhook_events(
  p_provider text,
  p_limit integer default 20
)
returns table (event_id text, payload jsonb, attempts integer)
language sql
security definer
set search_path = public, pg_temp
as $$
  select event_id, payload, attempts
    from public.hc_webhook_events
   where provider = p_provider
     and status in ('received', 'processing', 'retryable')
     and payload is not null
     and (locked_until is null or locked_until < now())
     -- Stop eventually rather than retrying a poisonous event forever.
     and attempts < 5
   order by received_at
   limit greatest(1, least(p_limit, 100));
$$;

revoke all on function public.hc_receive_webhook_event(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.hc_stuck_webhook_events(text, integer) from public, anon, authenticated;
grant execute on function public.hc_receive_webhook_event(text, text, jsonb) to service_role;
grant execute on function public.hc_stuck_webhook_events(text, integer) to service_role;

revoke all on function public.hc_claim_webhook_event(text, text, integer) from public, anon, authenticated;
revoke all on function public.hc_complete_webhook_event(text, text) from public, anon, authenticated;
revoke all on function public.hc_fail_webhook_event(text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.hc_claim_webhook_event(text, text, integer) to service_role;
grant execute on function public.hc_complete_webhook_event(text, text) to service_role;
grant execute on function public.hc_fail_webhook_event(text, text, text, boolean) to service_role;

comment on table public.hc_webhook_events is
  'Provider delivery ledger. Holds no tenant data: the tenant is not known until the connection is resolved. Idempotency plus a lease, so a failed attempt is retried rather than lost.';
