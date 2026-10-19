-- Channels beyond the website: connected Facebook Pages, Instagram accounts,
-- WhatsApp numbers and Google Business locations, plus the public items
-- (comments, reviews) the Reputation manager drafts replies for.
begin;

create table public.hc_channel_connections (
  tenant_id uuid not null references public.hc_tenants(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  provider text not null check (provider in ('meta', 'google')),
  kind text not null check (kind in ('facebook_page', 'instagram', 'whatsapp', 'google_location')),
  -- Page id, Instagram account id, WhatsApp phone number id, or Google location name.
  external_id text not null check (char_length(external_id) between 1 and 200),
  display_name text not null check (char_length(display_name) between 1 and 200),
  status text not null default 'connected' check (status in ('connected', 'error', 'disconnected')),
  -- AES-256-GCM ciphertext written and read only by the server.
  credentials text check (char_length(credentials) <= 8000),
  settings jsonb not null default '{}'::jsonb
    check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 4096),
  last_error text check (char_length(last_error) <= 300),
  last_synced_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  -- One workspace per page/account/number, so incoming events route to one place.
  unique (kind, external_id)
);

create trigger hc_channel_connections_updated_at
before update on public.hc_channel_connections
for each row execute function private.set_updated_at();

-- Conversations from messaging channels.
alter table public.hc_conversations drop constraint hc_conversations_channel_check;
alter table public.hc_conversations
  add constraint hc_conversations_channel_check
    check (channel in ('test', 'website', 'whatsapp', 'messenger', 'instagram')),
  add column connection_id uuid,
  add column external_thread_id text check (char_length(external_thread_id) <= 200),
  add constraint hc_conversations_connection_fkey
    foreign key (tenant_id, connection_id)
    references public.hc_channel_connections(tenant_id, id) on delete set null (connection_id);
create unique index hc_conversations_external_thread_idx
  on public.hc_conversations (tenant_id, connection_id, external_thread_id)
  where connection_id is not null and external_thread_id is not null;

-- Public items that get a reply only after the owner approves it.
create table public.hc_public_replies (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  connection_id uuid not null,
  kind text not null
    check (kind in ('facebook_comment', 'instagram_comment', 'google_review', 'facebook_recommendation')),
  external_id text not null check (char_length(external_id) between 1 and 300),
  parent_external_id text check (char_length(parent_external_id) <= 300),
  author_name text check (char_length(author_name) <= 120),
  body text not null default '' check (char_length(body) <= 8000),
  rating smallint check (rating between 1 and 5),
  permalink text check (char_length(permalink) <= 2000),
  draft text check (char_length(draft) <= 4000),
  -- new: waiting for a draft; drafted: waiting for the owner; then posted/skipped/failed.
  status text not null default 'new' check (status in ('new', 'drafted', 'posted', 'skipped', 'failed')),
  error text check (char_length(error) <= 300),
  received_at timestamptz not null default now(),
  decided_by uuid references auth.users(id) on delete set null,
  posted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (connection_id, external_id),
  foreign key (tenant_id, connection_id)
    references public.hc_channel_connections(tenant_id, id) on delete cascade
);
create index hc_public_replies_open_idx
  on public.hc_public_replies (tenant_id, status, received_at desc);

create trigger hc_public_replies_updated_at
before update on public.hc_public_replies
for each row execute function private.set_updated_at();

-- Webhook deliveries already handled (providers retry), server-only.
create table public.hc_webhook_events (
  provider text not null check (provider in ('meta', 'google')),
  event_id text not null check (char_length(event_id) <= 300),
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);

alter table public.hc_channel_connections enable row level security;
alter table public.hc_channel_connections force row level security;
alter table public.hc_public_replies enable row level security;
alter table public.hc_public_replies force row level security;
alter table public.hc_webhook_events enable row level security;
alter table public.hc_webhook_events force row level security;

create policy hc_channel_connections_member_select on public.hc_channel_connections
for select to authenticated
using ((select private.is_active_member(tenant_id)));
create policy hc_channel_connections_editor_update on public.hc_channel_connections
for update to authenticated
using ((select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[])))
with check ((select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[])));
create policy hc_channel_connections_editor_delete on public.hc_channel_connections
for delete to authenticated
using ((select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[])));

create policy hc_public_replies_member_select on public.hc_public_replies
for select to authenticated
using ((select private.is_active_member(tenant_id)));
create policy hc_public_replies_editor_update on public.hc_public_replies
for update to authenticated
using ((select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[])))
with check ((select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[])));

revoke all on public.hc_channel_connections, public.hc_public_replies, public.hc_webhook_events
  from public, anon, authenticated;
-- Credentials are never readable from the dashboard.
grant select (
  tenant_id, id, provider, kind, external_id, display_name, status, settings,
  last_error, last_synced_at, created_by, created_at, updated_at
) on public.hc_channel_connections to authenticated;
grant update (status) on public.hc_channel_connections to authenticated;
grant delete on public.hc_channel_connections to authenticated;
grant select on public.hc_public_replies to authenticated;
grant update (draft, status) on public.hc_public_replies to authenticated;
grant select (connection_id, external_thread_id) on public.hc_conversations to authenticated;

commit;
