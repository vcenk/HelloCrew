-- Local RLS check for conversations, messages and approvals.
-- Run after 00-supabase-stubs.sql and all migrations; it stops on the first failure.
\set ON_ERROR_STOP 1
insert into auth.users values
  ('00000000-0000-0000-0000-0000000000c1', 'carol@x.com'),
  ('00000000-0000-0000-0000-0000000000d1', 'dave@x.com')
on conflict do nothing;
select tenant_id as carol_tenant from hc_memberships
  where user_id = '00000000-0000-0000-0000-0000000000c1' \gset
select tenant_id as dave_tenant from hc_memberships
  where user_id = '00000000-0000-0000-0000-0000000000d1' \gset

-- A website conversation created by the server (service role bypasses RLS).
insert into hc_conversations (tenant_id, id, channel, title)
values (:'carol_tenant', '10000000-0000-0000-0000-000000000001', 'website', 'Visitor');

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';

-- Carol starts a test chat and stores both sides of it.
insert into hc_conversations (tenant_id, id, channel, title, created_by)
values (:'carol_tenant', '20000000-0000-0000-0000-000000000002', 'test', 'Hours?', auth.uid());
insert into hc_messages (tenant_id, conversation_id, role, body, engine)
values (:'carol_tenant', '20000000-0000-0000-0000-000000000002', 'customer', 'Hours?', 'practice'),
       (:'carol_tenant', '20000000-0000-0000-0000-000000000002', 'assistant', '9 to 5', 'practice');
do $$ begin
  if (select message_count from hc_conversations where id = '20000000-0000-0000-0000-000000000002') <> 2
    or (select last_message_preview from hc_conversations where id = '20000000-0000-0000-0000-000000000002') <> '9 to 5'
  then raise exception 'conversation summary not updated'; end if;
end $$;

-- In a real chat she may only add her own replies.
insert into hc_messages (tenant_id, conversation_id, role, body, engine)
values (:'carol_tenant', '10000000-0000-0000-0000-000000000001', 'owner', 'Hi, Carol here', 'human');
do $$ begin
  begin
    insert into hc_messages (tenant_id, conversation_id, role, body, engine)
    values ((select tenant_id from hc_conversations where id = '10000000-0000-0000-0000-000000000001'),
            '10000000-0000-0000-0000-000000000001', 'assistant', 'fake AI reply', 'live');
    raise exception 'owner forged an assistant message in a website chat';
  exception when insufficient_privilege then null; end;
  begin
    insert into hc_conversations (tenant_id, channel, title, created_by)
    values ((select tenant_id from hc_memberships limit 1), 'website', 'fake', auth.uid());
    raise exception 'owner created a website conversation';
  exception when insufficient_privilege then null; end;
  begin
    update hc_conversations set message_count = 0;
    raise exception 'owner changed a server-managed column';
  exception when insufficient_privilege then null; end;
  begin
    insert into hc_approvals (tenant_id, conversation_id, action_hash, status, expires_at)
    values ((select tenant_id from hc_memberships limit 1), '20000000-0000-0000-0000-000000000002', 'x', 'approved', now());
    raise exception 'owner inserted an approval';
  exception when insufficient_privilege then null; end;
end $$;

-- Take over and close are allowed.
update hc_conversations set mode = 'human', status = 'handoff'
where id = '10000000-0000-0000-0000-000000000001';

reset role;
insert into hc_approvals (tenant_id, id, conversation_id, action_hash, status, expires_at, summary)
values (:'carol_tenant', '30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
        'h', 'pending', now() + interval '1 day', 'Cut, Friday 3pm');
update hc_conversations set status = 'waiting' where id = '10000000-0000-0000-0000-000000000001';

-- Dave (another workspace) sees and decides nothing of Carol's.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000d1';
do $$ begin
  if (select count(*) from hc_conversations) + (select count(*) from hc_messages)
     + (select count(*) from hc_approvals) <> 0
  then raise exception 'cross-tenant read'; end if;
  begin
    perform hc_decide_approval('30000000-0000-0000-0000-000000000003', 'approved', 'ok');
    raise exception 'cross-tenant decision';
  exception when no_data_found then null; end;
end $$;
reset role;
select set_config('hc.carol', :'carol_tenant', false);
set role authenticated;
do $$ begin
  begin
    insert into hc_messages (tenant_id, conversation_id, role, body, engine)
    values (current_setting('hc.carol')::uuid, '10000000-0000-0000-0000-000000000001', 'owner', 'x', 'human');
    raise exception 'cross-tenant message insert';
  exception when insufficient_privilege then null; end;
end $$;

-- Carol approves once; the second decision is a no-op.
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
do $$
declare result jsonb;
begin
  result := hc_decide_approval('30000000-0000-0000-0000-000000000003', 'approved', 'Booked: see you Friday.');
  if result is null then raise exception 'decision failed'; end if;
  if hc_decide_approval('30000000-0000-0000-0000-000000000003', 'rejected', 'no') is not null
  then raise exception 'decided twice'; end if;
  if (select status from hc_approvals where id = '30000000-0000-0000-0000-000000000003') <> 'approved'
    or (select status from hc_conversations where id = '10000000-0000-0000-0000-000000000001') <> 'open'
    or (select count(*) from hc_messages where conversation_id = '10000000-0000-0000-0000-000000000001') <> 2
  then raise exception 'decision side effects wrong'; end if;
end $$;

-- Deleting a test chat removes its messages; website chats stay.
delete from hc_conversations where tenant_id = :'carol_tenant';
do $$ begin
  if (select count(*) from hc_conversations) <> 1 then raise exception 'delete scope wrong'; end if;
end $$;

set role anon;
do $$ begin
  begin
    perform count(*) from hc_messages;
    raise exception 'anon read messages';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'conversations RLS ok' as result;
