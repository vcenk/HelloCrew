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

- [ ] **WhatsApp** (Meta Cloud API via Embedded Signup v4; HelloCrew must be a Tech Provider with business verification and app review; v2 Embedded Signup is deprecated 2026-10-15). Each business connects its number; Meta bills the business per message for business-initiated messages.
- [ ] **Google reviews** (Business Profile API: request access per Google Cloud project, reviewed within ~14 days; needs a domain email and live website; OAuth verification for the business-management scope). Draft replies → owner approves on Today.
- [ ] **Phone** (Twilio or similar number + realtime voice model, or Vapi/Retell). Highest cost per minute; budget cap required.

## Platform

- [ ] Own domain for HelloCrew (helps Google and Meta reviews).
- [ ] Turn on Supabase leaked-password protection.
