-- Owner email alerts: where to send them and which events matter.
begin;

create table public.hc_notification_settings (
  tenant_id uuid primary key references public.hc_tenants(id) on delete cascade,
  email text check (email is null or (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  on_approval boolean not null default true,
  on_handoff boolean not null default true,
  on_lead boolean not null default true,
  on_new_chat boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create trigger hc_notification_settings_updated_at
before update on public.hc_notification_settings
for each row execute function private.set_updated_at();

alter table public.hc_notification_settings enable row level security;
alter table public.hc_notification_settings force row level security;

create policy hc_notification_settings_member_select on public.hc_notification_settings
for select to authenticated
using ((select private.is_active_member(tenant_id)));
create policy hc_notification_settings_owner_insert on public.hc_notification_settings
for insert to authenticated
with check (
  updated_by = (select auth.uid())
  and (select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[]))
);
create policy hc_notification_settings_owner_update on public.hc_notification_settings
for update to authenticated
using ((select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[])))
with check (
  updated_by = (select auth.uid())
  and (select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[]))
);

revoke all on public.hc_notification_settings from public, anon, authenticated;
grant select, insert, update on public.hc_notification_settings to authenticated;

commit;
