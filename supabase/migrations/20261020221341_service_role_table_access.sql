-- The server (service_role) runs webhooks, the website chat, review sync and
-- other background work. This project does not grant it table access by
-- default, so grant it explicitly on every HelloCrew table, now and later.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename like 'hc\_%' loop
    execute format('grant select, insert, update, delete on public.%I to service_role', t.tablename);
  end loop;
end $$;
grant usage, select on all sequences in schema public to service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;
