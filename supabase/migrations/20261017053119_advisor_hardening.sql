-- Address Supabase advisor findings after the workspace documents migration.

-- Cover foreign keys used by cascades and ownership lookups.
create index if not exists hc_approvals_conversation_idx
  on public.hc_approvals (tenant_id, conversation_id);
create index if not exists hc_knowledge_source_versions_created_by_idx
  on public.hc_knowledge_source_versions (created_by);
create index if not exists hc_knowledge_sources_approved_by_idx
  on public.hc_knowledge_sources (approved_by);
create index if not exists hc_workflow_versions_created_by_idx
  on public.hc_workflow_versions (created_by);
create index if not exists hc_workspace_documents_updated_by_idx
  on public.hc_workspace_documents (updated_by);

-- rls_auto_enable() is the project's event-trigger helper that turns on RLS for
-- new public tables. It only needs to run as an event trigger, never via the API.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;
