-- One automated turn per conversation at a time.
--
-- runCustomerTurn took no lock. Two messages arriving together on the same
-- conversation -- a customer sending twice, or a webhook retry racing the
-- original -- produced two overlapping model turns that each read the history
-- without the other's reply, then both answered. The customer gets two
-- replies that may contradict each other, and both are billed.
--
-- Human takeover had the same shape: mode was read once before the turn
-- started, so a turn already in flight still answered after a person took
-- over the conversation.
--
-- Forward recovery: additive. Existing rows get a null lease, which means
-- "free". Re-running is safe.

alter table public.hc_conversations
  -- Held while an automated turn is running. A worker that dies leaves this
  -- in the past, which is what makes the conversation recoverable instead of
  -- permanently unanswerable.
  add column if not exists turn_locked_until timestamptz,
  -- Who holds it. Only for diagnosing a stuck conversation; it is not a
  -- credential and grants nothing on its own.
  add column if not exists turn_owner uuid;

/*
 * Take the turn for one conversation, or refuse.
 *
 * Returns the lease owner when the caller may proceed, and null when it may
 * not -- either another turn holds a live lease, a person has taken the
 * conversation over, or it no longer exists. One conditional update, so two
 * callers racing cannot both receive an owner.
 *
 * `mode` is checked here rather than by the caller on purpose: a check in
 * application code is a read followed by a write, and a takeover landing
 * between the two is exactly the race worth closing.
 */
create or replace function public.hc_claim_conversation_turn(
  p_tenant_id uuid,
  p_conversation_id uuid,
  p_lease_seconds integer default 90
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid := gen_random_uuid();
  v_rows integer;
begin
  update public.hc_conversations
     set turn_locked_until = now() + make_interval(secs => p_lease_seconds),
         turn_owner = v_owner
   where tenant_id = p_tenant_id
     and id = p_conversation_id
     and mode = 'ai'
     and (turn_locked_until is null or turn_locked_until < now());
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    return v_owner;
  end if;
  return null;
end;
$$;

/*
 * Give the turn back.
 *
 * Scoped to the owner, so a worker whose lease already expired and was taken
 * by someone else cannot release the new holder's lease when it finally
 * finishes.
 */
create or replace function public.hc_release_conversation_turn(
  p_tenant_id uuid,
  p_conversation_id uuid,
  p_owner uuid
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.hc_conversations
     set turn_locked_until = null,
         turn_owner = null
   where tenant_id = p_tenant_id
     and id = p_conversation_id
     and turn_owner = p_owner;
$$;

/*
 * Whether this turn may still speak.
 *
 * Checked again after the model returns and before anything is stored or
 * sent. A turn takes seconds; a person can take the conversation over inside
 * that window, and the reply they were trying to prevent must not arrive.
 * False also when the lease expired and someone else took the turn.
 */
create or replace function public.hc_turn_still_valid(
  p_tenant_id uuid,
  p_conversation_id uuid,
  p_owner uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.hc_conversations
     where tenant_id = p_tenant_id
       and id = p_conversation_id
       and turn_owner = p_owner
       and mode = 'ai'
  );
$$;

revoke all on function public.hc_claim_conversation_turn(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.hc_release_conversation_turn(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.hc_turn_still_valid(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.hc_claim_conversation_turn(uuid, uuid, integer) to service_role;
grant execute on function public.hc_release_conversation_turn(uuid, uuid, uuid) to service_role;
grant execute on function public.hc_turn_still_valid(uuid, uuid, uuid) to service_role;

comment on column public.hc_conversations.turn_locked_until is
  'Lease on the automated turn. Expired or null means free; a dead worker recovers by expiry rather than staying stuck.';
