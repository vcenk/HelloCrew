-- Local RLS check for channel connections and public replies.
\set ON_ERROR_STOP 1
insert into auth.users values
  ('00000000-0000-0000-0000-0000000000e9', 'kim@x.com'),
  ('00000000-0000-0000-0000-0000000000f9', 'lee@x.com')
on conflict do nothing;
select tenant_id as kim_tenant from hc_memberships where user_id = '00000000-0000-0000-0000-0000000000e9' \gset
-- Server connects a page and stores a comment.
insert into hc_channel_connections (tenant_id, id, provider, kind, external_id, display_name, credentials)
values (:'kim_tenant', '70000000-0000-0000-0000-000000000001', 'meta', 'facebook_page', '1234567890', 'Kim Salon', 'v1:secret');
insert into hc_public_replies (tenant_id, id, connection_id, kind, external_id, body)
values (:'kim_tenant', '70000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000001', 'facebook_comment', 'c_1', 'Love it!');
do $$ begin
  begin
    insert into hc_channel_connections (tenant_id, provider, kind, external_id, display_name)
    values ((select tenant_id from hc_channel_connections limit 1), 'meta', 'facebook_page', '1234567890', 'Copy');
    raise exception 'same page connected twice';
  exception when unique_violation then null; end;
end $$;
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e9';
do $$ begin
  if (select display_name from hc_channel_connections) <> 'Kim Salon' then raise exception 'owner cannot see connection'; end if;
  begin
    perform credentials from hc_channel_connections;
    raise exception 'credentials readable';
  exception when insufficient_privilege then null; end;
  begin
    insert into hc_channel_connections (tenant_id, provider, kind, external_id, display_name)
    values ((select tenant_id from hc_memberships limit 1), 'meta', 'facebook_page', '999', 'Fake');
    raise exception 'owner inserted a connection';
  exception when insufficient_privilege then null; end;
  begin
    update hc_public_replies set body = 'edited';
    raise exception 'owner edited the customer comment';
  exception when insufficient_privilege then null; end;
end $$;
update hc_public_replies set draft = 'Thank you!', status = 'skipped';
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f9';
do $$ begin
  if (select count(*) from hc_channel_connections) + (select count(*) from hc_public_replies) <> 0
  then raise exception 'cross-tenant read'; end if;
  begin
    perform count(*) from hc_webhook_events;
    raise exception 'webhook events readable';
  exception when insufficient_privilege then null; end;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e9';
delete from hc_channel_connections;
do $$ begin
  if (select count(*) from hc_public_replies) <> 0 then raise exception 'replies left after disconnect'; end if;
end $$;
reset role;
select 'channel connections RLS ok' as result;
