-- Allow the dashboard's crew settings (skills per crew member) as a workspace document.
alter table public.hc_workspace_documents
  drop constraint if exists hc_workspace_documents_key_check;
alter table public.hc_workspace_documents
  add constraint hc_workspace_documents_key_check
  check (key in ('assistant_identity', 'knowledge', 'workflows', 'crew'));
