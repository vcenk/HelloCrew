begin;

create schema if not exists private;
revoke all on schema private from public;

create table public.hc_tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  status text not null default 'active'
    check (status in ('active', 'paused', 'archived')),
  timezone text not null default 'UTC'
    check (char_length(timezone) between 1 and 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.hc_memberships (
  tenant_id uuid not null references public.hc_tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'operator', 'viewer')),
  status text not null default 'active'
    check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create table public.hc_business_profiles (
  tenant_id uuid primary key references public.hc_tenants(id) on delete cascade,
  version bigint not null default 1 check (version > 0),
  profile jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.hc_workflows (
  tenant_id uuid not null references public.hc_tenants(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  source_template_key text,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  current_draft_version bigint not null default 1 check (current_draft_version > 0),
  published_version bigint check (published_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id)
);

create table public.hc_workflow_versions (
  tenant_id uuid not null,
  workflow_id uuid not null,
  version bigint not null check (version > 0),
  definition jsonb not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (tenant_id, workflow_id, version),
  foreign key (tenant_id, workflow_id)
    references public.hc_workflows(tenant_id, id) on delete cascade
);

create table public.hc_knowledge_sources (
  tenant_id uuid not null references public.hc_tenants(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  origin text not null check (origin in ('manual', 'upload', 'website')),
  kind text not null check (kind in ('hours', 'service', 'faq', 'policy', 'document')),
  name text not null check (char_length(name) between 1 and 160),
  language text not null default 'en' check (language in ('en', 'fa', 'zh')),
  status text not null default 'draft'
    check (status in ('draft', 'processing', 'approved', 'outdated', 'error', 'archived')),
  content text not null default '' check (char_length(content) <= 12000),
  content_hash text,
  current_version bigint not null default 1 check (current_version > 0),
  metadata jsonb not null default '{}'::jsonb,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  constraint hc_knowledge_sources_approval_check check (
    (status = 'approved' and approved_by is not null and approved_at is not null)
    or status <> 'approved'
  )
);

create table public.hc_knowledge_source_versions (
  tenant_id uuid not null,
  source_id uuid not null,
  version bigint not null check (version > 0),
  title text not null check (char_length(title) between 1 and 180),
  content text not null check (char_length(content) between 1 and 12000),
  language text not null check (language in ('en', 'fa', 'zh')),
  metadata jsonb not null default '{}'::jsonb,
  content_hash text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (tenant_id, source_id, version),
  foreign key (tenant_id, source_id)
    references public.hc_knowledge_sources(tenant_id, id) on delete cascade
);

create table public.hc_knowledge_chunks (
  tenant_id uuid not null,
  source_id uuid not null,
  source_version bigint not null,
  ordinal integer not null check (ordinal >= 0),
  content text not null check (char_length(content) between 1 and 4000),
  start_index integer check (start_index >= 0),
  token_count integer check (token_count > 0),
  content_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  search_vector tsvector generated always as (to_tsvector('simple', content)) stored,
  created_at timestamptz not null default now(),
  primary key (tenant_id, source_id, source_version, ordinal),
  foreign key (tenant_id, source_id, source_version)
    references public.hc_knowledge_source_versions(tenant_id, source_id, version)
    on delete cascade
);

create table public.hc_checkpoints (
  tenant_id uuid not null references public.hc_tenants(id) on delete cascade,
  conversation_id uuid not null,
  version bigint not null check (version > 0),
  state jsonb not null,
  expires_at timestamptz not null,
  primary key (tenant_id, conversation_id)
);

create table public.hc_approvals (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  conversation_id uuid not null,
  action_hash text not null,
  status text not null check (status in ('pending', 'approved', 'rejected', 'consumed')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, conversation_id)
    references public.hc_checkpoints(tenant_id, conversation_id) on delete cascade
);

create table public.hc_usage_reservations (
  tenant_id uuid not null references public.hc_tenants(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  request_id text not null,
  reserved_micro_usd bigint not null check (reserved_micro_usd >= 0),
  settled_micro_usd bigint check (settled_micro_usd >= 0),
  status text not null check (status in ('reserved', 'settled', 'uncertain')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, request_id)
);

create index hc_memberships_user_idx
  on public.hc_memberships (user_id, status, tenant_id);
create index hc_workflows_tenant_status_idx
  on public.hc_workflows (tenant_id, status, updated_at desc);
create index hc_knowledge_sources_tenant_status_idx
  on public.hc_knowledge_sources (tenant_id, status, language, kind);
create index hc_knowledge_chunks_source_idx
  on public.hc_knowledge_chunks (tenant_id, source_id, source_version);
create index hc_knowledge_chunks_search_idx
  on public.hc_knowledge_chunks using gin (search_vector);

create function private.is_active_member(requested_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.hc_memberships membership
    where membership.tenant_id = requested_tenant_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
  );
$$;

create function private.has_tenant_role(requested_tenant_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.hc_memberships membership
    where membership.tenant_id = requested_tenant_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and membership.role = any(allowed_roles)
  );
$$;

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_tenant_id uuid := gen_random_uuid();
  workspace_name text;
begin
  workspace_name := left(
    coalesce(nullif(split_part(new.email, '@', 1), ''), 'My') || ' workspace',
    100
  );

  insert into public.hc_tenants (id, name)
  values (new_tenant_id, workspace_name);

  insert into public.hc_memberships (tenant_id, user_id, role)
  values (new_tenant_id, new.id, 'owner');

  insert into public.hc_business_profiles (tenant_id)
  values (new_tenant_id);

  return new;
end;
$$;

revoke all on function private.is_active_member(uuid) from public;
revoke all on function private.has_tenant_role(uuid, text[]) from public;
revoke all on function private.set_updated_at() from public;
revoke all on function private.handle_new_user() from public;
grant usage on schema private to authenticated;
grant execute on function private.is_active_member(uuid) to authenticated;
grant execute on function private.has_tenant_role(uuid, text[]) to authenticated;

create trigger hc_tenants_set_updated_at
before update on public.hc_tenants
for each row execute function private.set_updated_at();
create trigger hc_workflows_set_updated_at
before update on public.hc_workflows
for each row execute function private.set_updated_at();
create trigger hc_knowledge_sources_set_updated_at
before update on public.hc_knowledge_sources
for each row execute function private.set_updated_at();

create trigger hc_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

alter table public.hc_tenants enable row level security;
alter table public.hc_tenants force row level security;
alter table public.hc_memberships enable row level security;
alter table public.hc_memberships force row level security;
alter table public.hc_business_profiles enable row level security;
alter table public.hc_business_profiles force row level security;
alter table public.hc_workflows enable row level security;
alter table public.hc_workflows force row level security;
alter table public.hc_workflow_versions enable row level security;
alter table public.hc_workflow_versions force row level security;
alter table public.hc_knowledge_sources enable row level security;
alter table public.hc_knowledge_sources force row level security;
alter table public.hc_knowledge_source_versions enable row level security;
alter table public.hc_knowledge_source_versions force row level security;
alter table public.hc_knowledge_chunks enable row level security;
alter table public.hc_knowledge_chunks force row level security;
alter table public.hc_checkpoints enable row level security;
alter table public.hc_checkpoints force row level security;
alter table public.hc_approvals enable row level security;
alter table public.hc_approvals force row level security;
alter table public.hc_usage_reservations enable row level security;
alter table public.hc_usage_reservations force row level security;

create policy hc_tenants_member_select on public.hc_tenants
for select to authenticated
using ((select private.is_active_member(id)));
create policy hc_tenants_owner_update on public.hc_tenants
for update to authenticated
using ((select private.has_tenant_role(id, array['owner']::text[])))
with check ((select private.has_tenant_role(id, array['owner']::text[])));

create policy hc_memberships_member_select on public.hc_memberships
for select to authenticated
using ((select private.is_active_member(tenant_id)));

create policy hc_business_profiles_member_select on public.hc_business_profiles
for select to authenticated
using ((select private.is_active_member(tenant_id)));
create policy hc_business_profiles_editor_insert on public.hc_business_profiles
for insert to authenticated
with check ((select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[])));
create policy hc_business_profiles_editor_update on public.hc_business_profiles
for update to authenticated
using ((select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[])))
with check ((select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[])));

create policy hc_workflows_member_select on public.hc_workflows
for select to authenticated
using ((select private.is_active_member(tenant_id)));
create policy hc_workflows_editor_insert on public.hc_workflows
for insert to authenticated
with check ((select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[])));
create policy hc_workflows_editor_update on public.hc_workflows
for update to authenticated
using ((select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[])))
with check ((select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[])));
create policy hc_workflows_owner_delete on public.hc_workflows
for delete to authenticated
using ((select private.has_tenant_role(tenant_id, array['owner']::text[])));

create policy hc_workflow_versions_member_select on public.hc_workflow_versions
for select to authenticated
using ((select private.is_active_member(tenant_id)));
create policy hc_workflow_versions_editor_insert on public.hc_workflow_versions
for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[]))
);

create policy hc_knowledge_sources_member_select on public.hc_knowledge_sources
for select to authenticated
using ((select private.is_active_member(tenant_id)));
create policy hc_knowledge_sources_editor_insert on public.hc_knowledge_sources
for insert to authenticated
with check ((select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[])));
create policy hc_knowledge_sources_editor_update on public.hc_knowledge_sources
for update to authenticated
using ((select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[])))
with check (
  (select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[]))
  and (
    status <> 'approved'
    or approved_by = (select auth.uid())
  )
);
create policy hc_knowledge_sources_owner_delete on public.hc_knowledge_sources
for delete to authenticated
using ((select private.has_tenant_role(tenant_id, array['owner']::text[])));

create policy hc_knowledge_versions_member_select on public.hc_knowledge_source_versions
for select to authenticated
using ((select private.is_active_member(tenant_id)));
create policy hc_knowledge_versions_editor_insert on public.hc_knowledge_source_versions
for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[]))
);

create policy hc_knowledge_chunks_member_select on public.hc_knowledge_chunks
for select to authenticated
using ((select private.is_active_member(tenant_id)));

revoke all on all tables in schema public from public, anon, authenticated;
grant select, update on public.hc_tenants to authenticated;
grant select on public.hc_memberships to authenticated;
grant select, insert, update on public.hc_business_profiles to authenticated;
grant select, insert, update, delete on public.hc_workflows to authenticated;
grant select, insert on public.hc_workflow_versions to authenticated;
grant select, insert, update, delete on public.hc_knowledge_sources to authenticated;
grant select, insert on public.hc_knowledge_source_versions to authenticated;
grant select on public.hc_knowledge_chunks to authenticated;

commit;
