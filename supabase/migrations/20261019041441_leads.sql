-- Leads: people who left their contact details for a quote or a call back.
-- Created by the server when the receptionist's "Capture leads" skill is on;
-- the owner follows up and marks them contacted, won or lost.
begin;

create table public.hc_leads (
  tenant_id uuid not null references public.hc_tenants(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  conversation_id uuid,
  contact_id uuid,
  name text not null check (char_length(name) between 1 and 80),
  email text check (char_length(email) <= 254),
  phone text check (char_length(phone) <= 40),
  interest text not null check (char_length(interest) between 1 and 300),
  status text not null default 'new' check (status in ('new', 'contacted', 'won', 'lost')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, conversation_id)
    references public.hc_conversations(tenant_id, id) on delete set null (conversation_id),
  foreign key (tenant_id, contact_id)
    references public.hc_contacts(tenant_id, id) on delete set null (contact_id),
  constraint hc_leads_contact_check check (email is not null or phone is not null)
);

create index hc_leads_recent_idx on public.hc_leads (tenant_id, status, created_at desc);

create trigger hc_leads_updated_at
before update on public.hc_leads
for each row execute function private.set_updated_at();

alter table public.hc_leads enable row level security;
alter table public.hc_leads force row level security;

create policy hc_leads_member_select on public.hc_leads
for select to authenticated
using ((select private.is_active_member(tenant_id)));
create policy hc_leads_editor_update on public.hc_leads
for update to authenticated
using ((select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[])))
with check ((select private.has_tenant_role(tenant_id, array['owner', 'operator']::text[])));

revoke all on public.hc_leads from public, anon, authenticated;
grant select on public.hc_leads to authenticated;
grant update (status) on public.hc_leads to authenticated;

commit;
