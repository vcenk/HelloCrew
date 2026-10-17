-- Dashboard document sync (Phase 1b).
-- The dashboard editors save whole documents (assistant identity, knowledge
-- store, workflow store). This table holds one versioned document per key per
-- tenant so a signed-in owner keeps their setup across browsers.
-- The normalized knowledge/workflow tables remain the runtime source of truth
-- the agent will read in Phase 2; documents are mirrored into them there.
begin;

create table public.hc_workspace_documents (
  tenant_id uuid not null references public.hc_tenants(id) on delete cascade,
  key text not null
    check (key in ('assistant_identity', 'knowledge', 'workflows')),
  version bigint not null default 1 check (version > 0),
  document jsonb not null,
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, key),
  constraint hc_workspace_documents_size_check
    check (pg_column_size(document) <= 524288)
);

-- Optimistic concurrency: every update must advance the version by exactly one,
-- so a stale writer (another tab or device) cannot silently overwrite newer work.
create function private.check_document_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.version <> old.version + 1 then
    raise exception 'stale document version' using errcode = '40001';
  end if;
  if new.tenant_id <> old.tenant_id or new.key <> old.key then
    raise exception 'document identity is immutable';
  end if;
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function private.check_document_version() from public;

create trigger hc_workspace_documents_version
before update on public.hc_workspace_documents
for each row execute function private.check_document_version();

alter table public.hc_workspace_documents enable row level security;
alter table public.hc_workspace_documents force row level security;

create policy hc_workspace_documents_member_select on public.hc_workspace_documents
for select to authenticated
using ((select private.is_active_member(tenant_id)));

create policy hc_workspace_documents_editor_insert on public.hc_workspace_documents
for insert to authenticated
with check (
  updated_by = (select auth.uid())
  and version = 1
  and (select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[]))
);

create policy hc_workspace_documents_editor_update on public.hc_workspace_documents
for update to authenticated
using ((select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[])))
with check (
  updated_by = (select auth.uid())
  and (select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[]))
);

revoke all on public.hc_workspace_documents from public, anon, authenticated;
grant select, insert, update on public.hc_workspace_documents to authenticated;

commit;
