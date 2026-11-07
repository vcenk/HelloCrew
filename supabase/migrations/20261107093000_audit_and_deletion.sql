-- Two things a supervised pilot needs and this schema did not have: a record
-- of what was done to a workspace, and a way to delete one.
--
-- lib/server/copilot/audit.ts said it plainly: "A structured server-side log,
-- not a table. There is no audit table in this schema." Logs are not
-- tenant-scoped, not queryable by the owner, and go away. An approval-first
-- product whose whole claim is that the owner stays in control should be able
-- to show the owner what happened.
--
-- Deletion did not exist in any form. A pilot business must be able to leave.
--
-- Forward recovery: two new tables, additive. Re-running is safe. Neither is
-- written by anything that already runs, so applying this changes no existing
-- behaviour until the code that uses it ships.

-- ---------------------------------------------------------------------------
-- What was done, and by whom
-- ---------------------------------------------------------------------------

create table if not exists public.hc_audit_events (
  tenant_id uuid not null references public.hc_tenants(id) on delete cascade,
  id uuid not null default gen_random_uuid(),

  -- Who. Null when the actor was the system rather than a person: a cron
  -- sweep, a provider webhook. The role is denormalized on purpose, because
  -- membership can change and the record should say what they were then.
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_role text check (actor_role is null or char_length(actor_role) <= 40),

  -- What. `action` is the registered action name, `event` its audit label.
  event text not null check (char_length(event) between 1 and 80),
  action text not null check (char_length(action) between 1 and 80),
  resource text not null check (char_length(resource) between 1 and 120),
  safety text not null check (
    safety in ('read_only', 'draft_write', 'live_configuration', 'external_write', 'destructive')
  ),
  outcome text not null check (
    outcome in ('applied', 'partial', 'rejected', 'failed', 'draft', 'refused')
  ),

  -- Counts only. Never the text that was written, never the customer's
  -- words, and never the model's reasoning: an audit line says who did what
  -- to which resource, not what it said. `reason` is bounded and is for a
  -- refusal code or a short provider message, not free-form content.
  applied_count integer check (applied_count is null or applied_count >= 0),
  skipped_count integer check (skipped_count is null or skipped_count >= 0),
  reason text check (reason is null or char_length(reason) <= 200),

  created_at timestamptz not null default now(),
  primary key (tenant_id, id)
);

create index if not exists hc_audit_events_recent
  on public.hc_audit_events (tenant_id, created_at desc);

alter table public.hc_audit_events enable row level security;
alter table public.hc_audit_events force row level security;

-- Members may read their own workspace's history. Nobody may write through
-- the browser: an audit record a client can forge is worth nothing.
create policy hc_audit_events_member_select on public.hc_audit_events
for select to authenticated
using ((select private.is_active_member(tenant_id)));

revoke all on public.hc_audit_events from public, anon, authenticated;
grant select on public.hc_audit_events to authenticated;
grant select, insert on public.hc_audit_events to service_role;

comment on table public.hc_audit_events is
  'Who did what to which resource, and how it ended. Counts and codes only: never document text, customer content, or model reasoning.';

-- ---------------------------------------------------------------------------
-- Deleting a workspace
-- ---------------------------------------------------------------------------

/*
 * A state machine rather than one cascading delete.
 *
 * Deletion touches storage objects and provider tokens as well as rows, so it
 * cannot be a single transaction. Doing it in recorded steps means a run that
 * dies halfway can be resumed, and the owner can be told truthfully where it
 * got to rather than "probably finished".
 *
 * The evidence kept is counts and timestamps. Keeping a copy of what was
 * deleted in order to prove it was deleted defeats the purpose.
 */
create table if not exists public.hc_workspace_deletions (
  tenant_id uuid not null references public.hc_tenants(id) on delete cascade,
  id uuid not null default gen_random_uuid(),

  status text not null default 'requested' check (
    status in ('requested', 'running', 'completed', 'failed')
  ),
  -- The step the next run should start from. Named rather than numbered so
  -- inserting a step later does not silently resume somewhere else.
  next_step text not null default 'conversations' check (char_length(next_step) <= 60),
  -- {"hc_messages": 412, "storage:knowledge": 7} — counts, never content.
  deleted_counts jsonb not null default '{}'::jsonb,

  requested_by uuid references auth.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 300),
  attempts integer not null default 0 check (attempts >= 0),
  -- Held while a run is working, so two runs cannot delete in parallel.
  locked_until timestamptz,

  primary key (tenant_id, id)
);

-- One live request per workspace. A second "delete my workspace" click must
-- join the run in progress rather than start a competing one.
create unique index if not exists hc_workspace_deletions_one_live
  on public.hc_workspace_deletions (tenant_id)
  where status in ('requested', 'running');

alter table public.hc_workspace_deletions enable row level security;
alter table public.hc_workspace_deletions force row level security;

-- The owner may see that deletion was requested and how far it has got.
-- Starting one is a server action that re-checks the role; it is not an
-- insert the browser can make.
create policy hc_workspace_deletions_owner_select on public.hc_workspace_deletions
for select to authenticated
using ((select private.has_tenant_role(tenant_id, array['owner']::text[])));

revoke all on public.hc_workspace_deletions from public, anon, authenticated;
grant select on public.hc_workspace_deletions to authenticated;
grant select, insert, update on public.hc_workspace_deletions to service_role;

comment on table public.hc_workspace_deletions is
  'Resumable workspace deletion. Keeps counts and timestamps as evidence, never the deleted content.';
