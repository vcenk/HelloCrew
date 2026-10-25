-- Google Calendar as a connectable account.
--
-- It reuses hc_channel_connections rather than getting a table of its own:
-- the row already carries an encrypted refresh token, a per-connection
-- settings object and the same RLS as every other connected account.
--
-- Calendar is connected separately from Google Business Profile. They need
-- different scopes, Business Profile access is review-gated by Google, and a
-- salon may well want one without the other.

alter table public.hc_channel_connections
  drop constraint if exists hc_channel_connections_kind_check;

alter table public.hc_channel_connections
  add constraint hc_channel_connections_kind_check
  check (
    kind in (
      'facebook_page',
      'instagram',
      'whatsapp',
      'google_location',
      'google_calendar'
    )
  );

-- settings for a google_calendar row holds the working hours the crew may
-- offer, which are deliberately not derived from the free-text opening hours
-- shown to customers:
--
--   {
--     "timeZone": "Europe/London",
--     "openingHours": { "1": [{ "opens": 540, "closes": 1020 }] },
--     "defaultDurationMinutes": 60,
--     "leadTimeMinutes": 120
--   }
--
-- opens/closes are minutes from local midnight; the key is the weekday with
-- 0 = Sunday. The existing 4096-byte settings check comfortably covers this.

comment on column public.hc_channel_connections.settings is
  'Per-connection configuration. For google_calendar: timeZone, openingHours, defaultDurationMinutes, leadTimeMinutes.';
