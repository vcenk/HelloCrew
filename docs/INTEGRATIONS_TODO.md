# Integrations to-do (later)

Parked on 2026-10-19 to focus on core features. Order reflects value and how much
waiting each approval needs. Each booking system plugs in behind one standard
**booking connection** (list services, list staff, check free times, create a
booking), so the receptionist, Skills and Today stay the same for every salon.

## Booking systems

| System | API | Access | Can book | Status |
|---|---|---|---|---|
| Phorest | Third Party API (Basic auth, `global/` username) | Salon opens a Phorest Support ticket from its account email with its Account Number; EU vs US/CA/AU server. Official partnership may carry integration charges. No webhooks (poll `updated_at`); no payments; no documented sandbox. | Yes: availability + create/cancel bookings | Waiting: Megas to send the ticket (draft written 2026-10-19). Ask how staff-level prices are exposed. |
| Square Appointments | Public Bookings API, OAuth | Self-serve: register HelloCrew as a Square app; each seller clicks Connect. | Yes. Seller-level writes need Appointments Plus/Premium (check `support_seller_level_writes`); free plan allows buyer-level bookings only. | To build first (no approval wait). |
| Vagaro | API + webhooks (OAuth 2.0 client id/secret) | Business enables it: Settings → Developers → APIs & Webhooks → Contact Us; ~5 business days review; paid plan with Vagaro card processing; about $10/month incl. 5,000 calls. | Yes; webhooks for appointment/customer changes | When a Vagaro salon signs up. |
| Fresha | No open API | Partner/add-on program only. | No until approved | Apply as partner once there are paying salons. |
| Booksy | No open API | No official route found; partner talks. | No | Contact once there are paying salons. |
| Google Calendar / Cal.com | Public APIs | OAuth / API key per business | Yes | For businesses without a booking system. |

Fallback for every salon until connected: the AI shares the booking link and
collects booking requests for the owner to approve on Today.

### Tasks
- [ ] `lib/booking/` connector interface: `listServices`, `listStaff`, `availability`, `createBooking`, `cancelBooking`, `sync` (poll or webhook).
- [ ] `hc_channel_connections` table: provider, account/location ids, encrypted credentials, status (connected / expired / error), last sync. Server-only access to secrets.
- [ ] Import services, staff and per-staff prices as Knowledge drafts (reuse the review flow); daily sync proposes updates.
- [ ] Booking skill "On its own" unlocked per connected provider; "Ask me first" posts the booking after owner approval.
- [ ] Square connector, then Phorest (Megas pilot), then Vagaro.
- [ ] Written OK from each pilot salon to process their client and appointment data.

## Messaging and reputation channels

Code is built (see `CHANNELS_SETUP.md`). Testable now on your own accounts with the Meta app in Development mode.

- [x] Connections framework: encrypted per-business tokens, Meta webhook with signature check and de-duplication, owner approval for every public reply.
- [x] Messenger and Instagram DMs answered by the receptionist; owner can take over and reply within the 24-hour window.
- [x] Facebook and Instagram comments + Facebook recommendations → drafts in Reputation manager.
- [x] WhatsApp via a pasted test/own number ID and token.
- [x] Google reviews connector (OAuth, location picker, 30-minute sync, reply posting).
- [ ] **Meta App Review + Business verification** for the permissions listed in `CHANNELS_SETUP.md`, so real salons can connect.
- [ ] **WhatsApp Embedded Signup** (Tech Provider) so salons connect their own numbers in one click; replace the paste form.
- [ ] WhatsApp message templates for replies after the 24-hour window.
- [ ] **Google Business Profile API access** — applied 2026-10-18 as AgentLand (agentland.app), Cloud project 254950461858, support case 9-9447000041906, review 7–10 business days. Then: approval (needs a domain email and live website; ~14 days) + OAuth verification for `business.manage`.
- [ ] Media messages (images, voice notes) — currently text only.
- [ ] **Phone** (Twilio or similar number + realtime voice model, or Vapi/Retell). Highest cost per minute; budget cap required.

## Email alerts (Resend) — code done, setup waiting for a domain

The alert feature is built (Settings → Email alerts; `lib/server/notify.ts`) and
stays silently off until these steps are done:

- [ ] Register a domain for HelloCrew.
- [ ] Create a Resend account, add the domain, and add the DNS records Resend gives (SPF/DKIM) at the domain registrar; wait until Resend shows it verified.
- [ ] Create a Resend API key.
- [ ] In Vercel → Settings → Environment Variables (and `.env.local` for local testing): `RESEND_API_KEY=<key>` and `NOTIFY_FROM=HelloCrew <alerts@yourdomain.com>`; redeploy.
- [ ] Settings → Email alerts → **Send a test** and check the inbox (and spam folder).
- Note: before a domain is verified, Resend's test sender only delivers to the Resend account's own email, so real owners wouldn't receive alerts.

## Platform

- [ ] Own domain for HelloCrew (helps Google and Meta reviews, and needed for email alerts).
- [ ] Turn on Supabase leaked-password protection.
