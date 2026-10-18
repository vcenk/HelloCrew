-- Phase 3: a website chat per workspace.
-- Each workspace gets one public widget id. Browsers may only embed it on the
-- allowed websites (enforced with a frame-ancestors header), and visitors get
-- an anonymous conversation proven by a secret token whose hash is stored.
begin;

create table public.hc_widget_installations (
  tenant_id uuid not null references public.hc_tenants(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  public_id text not null unique check (public_id ~ '^w-[a-z0-9]{20}$'),
  allowed_origins text[] not null default '{}'
    check (cardinality(allowed_origins) <= 10),
  enabled boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id)
);

create trigger hc_widget_installations_updated_at
before update on public.hc_widget_installations
for each row execute function private.set_updated_at();

alter table public.hc_conversations
  add column visitor_token_hash text
    check (visitor_token_hash is null or visitor_token_hash ~ '^[0-9a-f]{64}$');

alter table public.hc_widget_installations enable row level security;
alter table public.hc_widget_installations force row level security;

create policy hc_widget_installations_member_select on public.hc_widget_installations
for select to authenticated
using ((select private.is_active_member(tenant_id)));
create policy hc_widget_installations_editor_insert on public.hc_widget_installations
for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[]))
);
create policy hc_widget_installations_editor_update on public.hc_widget_installations
for update to authenticated
using ((select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[])))
with check ((select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[])));

revoke all on public.hc_widget_installations from public, anon, authenticated;
grant select, insert on public.hc_widget_installations to authenticated;
grant update (allowed_origins, enabled) on public.hc_widget_installations to authenticated;

-- Visitor tokens are secrets for the widget only; the dashboard never needs them.
revoke select on public.hc_conversations from authenticated;
grant select (
  tenant_id, id, channel, contact_id, title, status, mode, last_message_at,
  last_message_preview, message_count, created_by, created_at, updated_at
) on public.hc_conversations to authenticated;

commit;
