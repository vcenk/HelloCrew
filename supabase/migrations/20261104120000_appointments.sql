-- A local record of every appointment HelloCrew booked.
--
-- Until now a confirmed booking existed only as a Google Calendar event.
-- That is enough to keep a diary and not enough to run anything on top of
-- one: there is no way to ask "which appointments are tomorrow and have we
-- reminded anyone", no record for a workspace whose calendar is later
-- disconnected, and nowhere to keep the customer's own contact details,
-- which never reach Google because the event has no attendees.
--
-- The calendar stays the source of truth for whether a slot is taken. This
-- table is the record of what HelloCrew did, which is a different question.

begin;

create table public.hc_appointments (
  -- Keyed (tenant_id, id) like every other tenant table, so a foreign key
  -- to it has to carry the tenant too. hc_conversations and hc_contacts
  -- are keyed the same way, which is why the references below are
  -- composite: a single-column one would compile only if those tables had
  -- a bare unique id, and would then let a row point at another
  -- workspace's conversation. The schema refuses instead.
  tenant_id uuid not null references public.hc_tenants(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  conversation_id uuid,
  contact_id uuid,

  service text not null check (char_length(service) between 1 and 200),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- The business's own wording for the time, built where the timezone was
  -- known. Re-deriving a local time later means guessing a zone that may
  -- since have changed.
  says text check (says is null or char_length(says) <= 200),

  customer_name text check (customer_name is null or char_length(customer_name) <= 120),
  -- Null far more often than not: a website visitor is never asked for one.
  -- A reminder is only sent when there is somewhere to send it.
  customer_email text check (
    customer_email is null
    or (char_length(customer_email) <= 254 and customer_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
  ),

  -- The same key the calendar event carries, so the two can be matched and
  -- a replayed approval updates one row instead of inserting a second.
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  external_event_id text check (external_event_id is null or char_length(external_event_id) <= 400),

  status text not null default 'booked' check (status in ('booked', 'cancelled')),
  -- Set when a reminder was actually accepted for delivery. Null means not
  -- yet; it is never set optimistically, because a reminder nobody received
  -- that the system believes it sent is worse than none at all.
  reminder_sent_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint hc_appointments_ends_after_start check (ends_at > starts_at),
  constraint hc_appointments_key_per_tenant unique (tenant_id, idempotency_key),
  primary key (tenant_id, id),
  foreign key (tenant_id, conversation_id)
    references public.hc_conversations(tenant_id, id) on delete set null (conversation_id),
  foreign key (tenant_id, contact_id)
    references public.hc_contacts(tenant_id, id) on delete set null (contact_id)
);

-- The cron's only query: upcoming, still booked, not yet reminded.
create index hc_appointments_due on public.hc_appointments (starts_at)
  where status = 'booked' and reminder_sent_at is null;
create index hc_appointments_tenant_start on public.hc_appointments (tenant_id, starts_at desc);

create trigger hc_appointments_updated_at
before update on public.hc_appointments
for each row execute function private.set_updated_at();

alter table public.hc_appointments enable row level security;
alter table public.hc_appointments force row level security;

-- Members may read their own workspace's appointments. Nobody writes them
-- from a browser: they are created by the server when an owner approves a
-- booking, so there is no insert or update policy for authenticated at all.
create policy hc_appointments_member_select on public.hc_appointments
for select to authenticated
using ((select private.is_active_member(tenant_id)));

revoke all on public.hc_appointments from public, anon, authenticated;
grant select on public.hc_appointments to authenticated;
grant select, insert, update on public.hc_appointments to service_role;

-- Owners choose whether customers get a reminder at all.
alter table public.hc_notification_settings
  add column if not exists on_reminder boolean not null default true;

comment on table public.hc_appointments is
  'What HelloCrew booked. The connected calendar remains the source of truth for availability.';

commit;
