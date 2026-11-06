-- The owner's daily digest: one email the evening before, listing the
-- appointments booked for tomorrow.
--
-- Two columns on the settings row the workspace already has. No new table,
-- because there is no new thing being stored — only whether this owner
-- wants the digest, and whether today's has already gone out.

begin;

alter table public.hc_notification_settings
  add column if not exists on_digest boolean not null default true;

-- The local date of the last digest sent, as YYYY-MM-DD in the business's
-- own timezone. A date rather than a timestamp on purpose: the question is
-- "has today's gone out", and the cron runs hourly, so without this it
-- would send one every hour of the sending window.
--
-- Set only after the mail provider accepts the message, the same way
-- hc_appointments.reminder_sent_at is, so a failed send is retried on the
-- next run rather than silently skipped for the day.
alter table public.hc_notification_settings
  add column if not exists last_digest_on date;

comment on column public.hc_notification_settings.last_digest_on is
  'Local date (business timezone) of the last owner digest actually accepted for delivery.';

commit;
