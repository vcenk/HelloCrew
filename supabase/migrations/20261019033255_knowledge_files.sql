-- Knowledge from files (and later web pages).
-- The original file is kept in a private storage bucket. Its text is stored
-- and split into searchable chunks. The AI suggests knowledge items from it;
-- the owner reviews them, and decides whether the crew may search the full text.
begin;

create table public.hc_knowledge_files (
  tenant_id uuid not null references public.hc_tenants(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  kind text not null default 'file' check (kind in ('file', 'url')),
  title text not null check (char_length(title) between 1 and 180),
  file_name text check (char_length(file_name) <= 240),
  mime_type text check (char_length(mime_type) <= 160),
  size_bytes integer check (size_bytes between 0 and 10485760),
  storage_path text check (char_length(storage_path) <= 400),
  source_url text check (char_length(source_url) <= 2000),
  -- uploading → reading → review (owner checks suggestions) → ready; or error.
  status text not null default 'uploading'
    check (status in ('uploading', 'reading', 'review', 'ready', 'error')),
  error text check (char_length(error) <= 300),
  text_content text not null default '' check (char_length(text_content) <= 400000),
  page_count integer check (page_count >= 0),
  use_for_answers boolean not null default false,
  suggested_count integer not null default 0 check (suggested_count >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id)
);

create table public.hc_knowledge_file_chunks (
  tenant_id uuid not null,
  file_id uuid not null,
  ordinal integer not null check (ordinal >= 0),
  content text not null check (char_length(content) between 1 and 2400),
  search_vector tsvector generated always as (to_tsvector('simple', content)) stored,
  primary key (tenant_id, file_id, ordinal),
  foreign key (tenant_id, file_id)
    references public.hc_knowledge_files(tenant_id, id) on delete cascade
);

create index hc_knowledge_files_recent_idx
  on public.hc_knowledge_files (tenant_id, created_at desc);
create index hc_knowledge_file_chunks_search_idx
  on public.hc_knowledge_file_chunks using gin (search_vector);

create trigger hc_knowledge_files_updated_at
before update on public.hc_knowledge_files
for each row execute function private.set_updated_at();

-- Full-text search over files the owner allowed the crew to read.
-- Runs with the caller's rights, so RLS still limits a signed-in user to
-- their own workspace; the server passes the tenant it verified.
create function public.hc_search_file_chunks(p_tenant_id uuid, p_query text, p_limit integer default 4)
returns table (file_id uuid, title text, ordinal integer, content text, rank real)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.file_id, f.title, c.ordinal, c.content,
         ts_rank_cd(c.search_vector, to_tsquery('simple', p_query)) as rank
  from public.hc_knowledge_file_chunks c
  join public.hc_knowledge_files f
    on f.tenant_id = c.tenant_id and f.id = c.file_id
  where c.tenant_id = p_tenant_id
    and f.use_for_answers
    and f.status = 'ready'
    and c.search_vector @@ to_tsquery('simple', p_query)
  order by rank desc
  limit least(greatest(p_limit, 1), 8);
$$;
revoke all on function public.hc_search_file_chunks(uuid, text, integer) from public, anon;
grant execute on function public.hc_search_file_chunks(uuid, text, integer) to authenticated, service_role;

alter table public.hc_knowledge_files enable row level security;
alter table public.hc_knowledge_files force row level security;
alter table public.hc_knowledge_file_chunks enable row level security;
alter table public.hc_knowledge_file_chunks force row level security;

create policy hc_knowledge_files_member_select on public.hc_knowledge_files
for select to authenticated
using ((select private.is_active_member(tenant_id)));
create policy hc_knowledge_files_editor_insert on public.hc_knowledge_files
for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[]))
);
create policy hc_knowledge_files_editor_update on public.hc_knowledge_files
for update to authenticated
using ((select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[])))
with check ((select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[])));
create policy hc_knowledge_files_editor_delete on public.hc_knowledge_files
for delete to authenticated
using ((select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[])));

create policy hc_knowledge_file_chunks_member_select on public.hc_knowledge_file_chunks
for select to authenticated
using ((select private.is_active_member(tenant_id)));
create policy hc_knowledge_file_chunks_editor_insert on public.hc_knowledge_file_chunks
for insert to authenticated
with check ((select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[])));
create policy hc_knowledge_file_chunks_editor_delete on public.hc_knowledge_file_chunks
for delete to authenticated
using ((select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[])));

revoke all on public.hc_knowledge_files, public.hc_knowledge_file_chunks from public, anon, authenticated;
grant select, insert, delete on public.hc_knowledge_files to authenticated;
grant update (title, status, error, text_content, page_count, use_for_answers, suggested_count)
  on public.hc_knowledge_files to authenticated;
grant select, insert, delete on public.hc_knowledge_file_chunks to authenticated;

-- Private bucket for original files. No storage policies: only the server
-- (service role) reads or writes, handing out short-lived signed URLs.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'knowledge', 'knowledge', false, 10485760,
      array[
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain', 'text/csv', 'text/markdown'
      ]
    )
    on conflict (id) do nothing;
  end if;
end $$;

commit;
