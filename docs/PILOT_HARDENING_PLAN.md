# Pilot hardening plan

Written 2026-11-07, before any code changed, from reading the implementation rather than the older
planning documents. Target: a small, supervised Canadian pilot as an approval-first AI front desk for
independent salons and wellness studios with 2–10 staff, working beside the booking system the business
already uses.

Tree was clean at `f704863` when this started, so no unrelated user work is at risk.

## What the code actually does today

| Claim in the repo | What the code does |
| --- | --- |
| README: "not live AI" | `runCustomerTurn` runs a live OpenAI turn whenever the tenant has `live_ai_enabled`. One production tenant has it on. |
| README: "real customers… not supported yet" | `hc_conversations`, `hc_messages`, `hc_contacts`, `hc_leads` and `hc_appointments` all persist real data under forced RLS. |
| README: "external actions are not supported" | Google Calendar booking, Resend email, and Meta send are all implemented; reminders and the owner digest were sent and delivered in production. |
| Landing: "booking systems are planned, not available yet" | Google Calendar booking works. |
| `package.json`: "A safe practice studio" | Describes an earlier product. |

So the documentation understates the product, which is its own risk: it hides live behaviour from anyone
reviewing the repo.

## Findings behind each phase

**Phase 2.** `handleMessage` calls `firstDelivery` at `lib/server/inbound.ts:76`, which inserts into
`hc_webhook_events` *before* conversation storage, the AI turn and outbound delivery. The route already
returned 200 from inside `after()`. So any later failure is permanent: Meta's retry carries the same event
id, `firstDelivery` returns false, and the message is dropped silently. `handleMetaEvent` also swallows the
error. `hc_webhook_events` is `(provider, event_id, received_at)` only — no status, attempts or lease.

**Phase 3.** `runCustomerTurn` takes no lock. Two messages arriving together on one conversation produce two
overlapping AI turns. Human takeover is checked once before the turn starts, so a turn already in flight
still replies after a person takes over.

**Phase 4.** `lib/server/rate-limit.ts` is an in-memory `Map`, and says so. On serverless each instance has
its own, so the limit is roughly *instances × limit*.

**Phase 5.** `lib/server/copilot/audit.ts` writes `console.info` and states "There is no audit table".
There is no workspace deletion of any kind.

## Plan

Small, separately committed, each with migration and tests. Postgres is the only shared resource used —
no new service.

1. **Phase 1 — product truth.** Rewrite the README status, `package.json` description, the landing line
   about booking, and add a status table to `docs/VERIFICATION.md` with four honest states: usable;
   awaiting provider approval; implemented but not production-verified; not built.

2. **Phase 2 — durable webhook lifecycle.** Migration adds `status`, `attempts`, `locked_until`,
   `last_error` (bounded, no PII) and `completed_at` to `hc_webhook_events`. Claim an event with an atomic
   conditional update rather than a bare insert, so a second worker cannot take the same row. Mark
   `completed` only after delivery; mark `failed`/`retryable` with a bounded reason on error so the
   provider's retry is honoured.

3. **Phase 3 — serialize turns.** Lease column on `hc_conversations` (`turn_locked_until`, `turn_owner`),
   taken by a conditional update. Expired leases are reclaimable. The lease check re-reads `mode`, so a
   human takeover during a turn stops the automated reply before it is stored or sent.

4. **Phase 4 — shared limiter.** A `hc_rate_limits` table with an atomic increment in a `security definer`
   function, keyed by scope + visitor/IP + installation. Fails **open** on limiter error, because the usage
   ledger is the authoritative spend control and a limiter outage must not take the widget down. Same 429
   and `Retry-After` shape as today.

5. **Phase 5 — audit and deletion.** `hc_audit_events` (tenant-scoped, RLS forced): actor, action, resource,
   safety level, outcome, timestamp — no model reasoning, no message bodies. `recordCopilotAudit` writes
   there as well as to the log. A `hc_workspace_deletions` state machine enumerating every table and storage
   prefix, advancing in steps, keeping only counts as evidence.

6. **Phase 6 — verification.** Tests for tenant isolation, webhook recovery, serialized turns, approval
   behaviour and audit rows. Then lint, typecheck, unit tests, production build and Playwright, with a
   verification report stating exactly what ran. Live model evals stay out of ordinary CI.

## Constraints being honoured

No deploys, no paid services, no provider settings changed, no secrets, no Stripe, voice, Meta or Google
approval work. Forced RLS and composite tenant keys preserved on every new table. Every new server entry
point verifies auth itself. Migrations are additive, with a forward-recovery note in each file.

## What this plan does not fix

Meta App Review and Google Business Profile approval are external. Pricing needs the ten interviews named in
`PRICING_STRATEGY.md`. Canadian French is scoped as the next language but not implemented here. None of this
makes the product production-ready, and the verification report will not say that it is.
