-- Phase 2b: server-stored conversations.
-- Conversations, messages and owner approvals live on the server so chats
-- survive the browser, Today can show real work, and an owner can take over.
-- The agent rebuilds its state from stored messages on every turn, so no
-- separate graph checkpoint is needed to resume after an approval.
begin;

-- Contacts: who a conversation is with (website visitors later).
create table public.hc_contacts (
  tenant_id uuid not null references public.hc_tenants(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  display_name text check (char_length(display_name) <= 120),
  email text check (char_length(email) <= 254),
  phone text check (char_length(phone) <= 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id)
);

create table public.hc_conversations (
  tenant_id uuid not null references public.hc_tenants(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  channel text not null default 'test' check (channel in ('test', 'website')),
  contact_id uuid,
  title text not null default 'New conversation'
    check (char_length(title) between 1 and 160),
  -- open: the AI is handling it; waiting: an approval is pending;
  -- handoff: a person should reply; closed: done.
  status text not null default 'open'
    check (status in ('open', 'waiting', 'handoff', 'closed')),
  -- human: the owner took over and the AI stays quiet.
  mode text not null default 'ai' check (mode in ('ai', 'human')),
  last_message_at timestamptz not null default now(),
  last_message_preview text not null default ''
    check (char_length(last_message_preview) <= 200),
  message_count integer not null default 0 check (message_count >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, contact_id)
    references public.hc_contacts(tenant_id, id) on delete set null (contact_id)
);

create table public.hc_messages (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  conversation_id uuid not null,
  role text not null check (role in ('customer', 'assistant', 'owner')),
  body text not null check (char_length(body) between 1 and 4000),
  engine text check (engine in ('practice', 'live', 'human')),
  meta jsonb not null default '{}'::jsonb
    check (jsonb_typeof(meta) = 'object' and pg_column_size(meta) <= 16384),
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, conversation_id)
    references public.hc_conversations(tenant_id, id) on delete cascade
);

create index hc_conversations_recent_idx
  on public.hc_conversations (tenant_id, last_message_at desc);
create index hc_messages_conversation_idx
  on public.hc_messages (tenant_id, conversation_id, created_at);

-- Approvals were drafted against graph checkpoints; they now belong to a
-- conversation and the message that proposed them. The table is empty.
alter table public.hc_approvals
  drop constraint hc_approvals_tenant_id_conversation_id_fkey;
alter table public.hc_approvals
  add column message_id uuid,
  add column kind text not null default 'booking' check (kind in ('booking')),
  add column summary text not null default '' check (char_length(summary) <= 300),
  add column details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object' and pg_column_size(details) <= 4096),
  add column decided_by uuid references auth.users(id) on delete set null,
  add column decided_at timestamptz,
  alter column expires_at set default (now() + interval '14 days'),
  add constraint hc_approvals_conversation_fkey
    foreign key (tenant_id, conversation_id)
    references public.hc_conversations(tenant_id, id) on delete cascade;
create index hc_approvals_pending_idx
  on public.hc_approvals (tenant_id, status, created_at desc);

create trigger hc_contacts_updated_at
before update on public.hc_contacts
for each row execute function private.set_updated_at();
create trigger hc_conversations_updated_at
before update on public.hc_conversations
for each row execute function private.set_updated_at();

-- Keeps the conversation summary in step with its messages and caps length.
create function private.handle_new_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_count integer;
begin
  select message_count into current_count
  from public.hc_conversations
  where tenant_id = new.tenant_id and id = new.conversation_id
  for update;
  if current_count >= 500 then
    raise exception 'conversation is full' using errcode = '54000';
  end if;
  update public.hc_conversations
  set last_message_at = new.created_at,
      last_message_preview = left(new.body, 200),
      message_count = message_count + 1,
      status = case
        when status = 'closed' and new.role = 'customer' then 'open'
        else status
      end
  where tenant_id = new.tenant_id and id = new.conversation_id;
  return new;
end;
$$;
revoke all on function private.handle_new_message() from public;

create trigger hc_messages_before_insert
before insert on public.hc_messages
for each row execute function private.handle_new_message();

-- Owner decision on a pending approval: records who decided, adds the reply
-- the customer sees, and clears the waiting status when nothing else waits.
create function public.hc_decide_approval(
  p_approval_id uuid,
  p_decision text,
  p_reply text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  approval public.hc_approvals%rowtype;
  message public.hc_messages%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'invalid decision' using errcode = '22023';
  end if;
  if p_reply is null or char_length(p_reply) not between 1 and 600 then
    raise exception 'invalid reply' using errcode = '22023';
  end if;

  select * into approval from public.hc_approvals
  where id = p_approval_id
  for update;
  if not found
    or not private.has_tenant_role(approval.tenant_id, array['owner', 'operator']::text[]) then
    raise exception 'approval not found' using errcode = 'P0002';
  end if;
  if approval.status <> 'pending' or approval.expires_at < now() then
    return null;
  end if;

  update public.hc_approvals
  set status = p_decision, decided_by = (select auth.uid()), decided_at = now()
  where tenant_id = approval.tenant_id and id = approval.id;

  insert into public.hc_messages (tenant_id, conversation_id, role, body, engine, meta)
  values (
    approval.tenant_id, approval.conversation_id, 'assistant', p_reply, 'live',
    jsonb_build_object('decision', p_decision, 'approvalId', approval.id)
  )
  returning * into message;

  update public.hc_conversations c
  set status = 'open'
  where c.tenant_id = approval.tenant_id
    and c.id = approval.conversation_id
    and c.status = 'waiting'
    and not exists (
      select 1 from public.hc_approvals a
      where a.tenant_id = c.tenant_id
        and a.conversation_id = c.id
        and a.status = 'pending'
    );

  return jsonb_build_object(
    'id', message.id,
    'conversationId', message.conversation_id,
    'body', message.body,
    'createdAt', message.created_at
  );
end;
$$;
revoke all on function public.hc_decide_approval(uuid, text, text) from public, anon;
grant execute on function public.hc_decide_approval(uuid, text, text) to authenticated;

-- Row-level security.
alter table public.hc_contacts enable row level security;
alter table public.hc_contacts force row level security;
alter table public.hc_conversations enable row level security;
alter table public.hc_conversations force row level security;
alter table public.hc_messages enable row level security;
alter table public.hc_messages force row level security;

create policy hc_contacts_member_select on public.hc_contacts
for select to authenticated
using ((select private.is_active_member(tenant_id)));
create policy hc_contacts_editor_insert on public.hc_contacts
for insert to authenticated
with check ((select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[])));
create policy hc_contacts_editor_update on public.hc_contacts
for update to authenticated
using ((select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[])))
with check ((select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[])));

create policy hc_conversations_member_select on public.hc_conversations
for select to authenticated
using ((select private.is_active_member(tenant_id)));
-- Owners create test chats; website chats are created by the server.
create policy hc_conversations_editor_insert on public.hc_conversations
for insert to authenticated
with check (
  channel = 'test'
  and created_by = (select auth.uid())
  and (select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[]))
);
create policy hc_conversations_editor_update on public.hc_conversations
for update to authenticated
using ((select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[])))
with check ((select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[])));
create policy hc_conversations_editor_delete on public.hc_conversations
for delete to authenticated
using (
  channel = 'test'
  and (select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[]))
);

create policy hc_messages_member_select on public.hc_messages
for select to authenticated
using ((select private.is_active_member(tenant_id)));
-- In test chats the owner plays the customer and stores practice replies.
-- In real chats the owner can only add their own replies.
create policy hc_messages_editor_insert on public.hc_messages
for insert to authenticated
with check (
  (select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[]))
  and (
    (role = 'owner' and engine = 'human')
    or exists (
      select 1 from public.hc_conversations c
      where c.tenant_id = hc_messages.tenant_id
        and c.id = hc_messages.conversation_id
        and c.channel = 'test'
    )
  )
);

-- Approvals are created by the server and decided through hc_decide_approval.
create policy hc_approvals_member_select on public.hc_approvals
for select to authenticated
using ((select private.is_active_member(tenant_id)));

revoke all on public.hc_contacts, public.hc_conversations, public.hc_messages, public.hc_approvals
  from public, anon, authenticated;
grant select, insert on public.hc_contacts to authenticated;
grant update (display_name, email, phone) on public.hc_contacts to authenticated;
grant select, insert, delete on public.hc_conversations to authenticated;
grant update (title, status, mode) on public.hc_conversations to authenticated;
grant select, insert on public.hc_messages to authenticated;
grant select on public.hc_approvals to authenticated;

commit;
