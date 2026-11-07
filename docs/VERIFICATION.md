# Verification and honest status

Current as of 2026-11-07. Supersedes the 2026-10-13 report, which described a synthetic prototype and is no
longer true of this code: it stated "Live AI always returns 503" and "No real booking, customer message,
payment, or human handoff is performed". Both were correct then and are wrong now.

**This project is not production-ready.** Nothing below should be read as a compliance claim, a provider
approval, or evidence that the product is safe for unsupervised use with real customers.

## What works and what does not

### Usable now — exercised against real infrastructure

| Capability | Evidence |
| --- | --- |
| Website chat widget, isolated iframe, allowed-origin checks | Playwright specs under `tests/e2e` |
| Live OpenAI turns for signed-in owners, on the usage ledger | `hc_usage_reservations` holds 52 settled requests; per-tenant and platform caps enforced before each call |
| Google Calendar booking | Connection, availability and appointment creation implemented and connected |
| Customer appointment reminders by email | Sent and delivered to a real inbox on 2026-11-07, from the business's own display name |
| Owner daily digest of tomorrow's appointments | Sent and delivered on 2026-11-07 |
| Google sign-in, tenant membership, forced RLS on every tenant table | `tests/migrations-rls.test.ts` asserts it per migration in CI |
| Approval gate on risky Copilot actions | `confirmCopilotAction`; covered in `tests/copilot-workflow-server.test.ts` |
| Knowledge base, workflow builder and published versions, conversations inbox, staff and service pricing | Covered by unit and Playwright suites |

### Implemented, blocked on someone else's approval

| Capability | Blocked by |
| --- | --- |
| WhatsApp, Instagram and Facebook messaging | Meta App Review. Code, webhook and send paths exist; no real traffic can arrive until approved. |
| Google Business Profile review replies | Google's approval of Business Profile access. The connector shows "Coming soon" with the reason. |

### Implemented but never verified against real traffic

- The Meta inbound webhook end to end. There is no approved app, so it has never received a real event.
- Lead capture, handoff and approval flows at any volume beyond manual testing.
- Behaviour under concurrent customers in one workspace.
- The `gpt-6-luna` cost projection. The switch is deployed and the live evals pass 13/13, but no settled
  ledger rows exist for it yet, so the ~29% saving in `PRICING_STRATEGY.md` remains arithmetic, not measurement.

### Not built

Billing and Stripe. Voice and telephone. Multi-user accounts and team invites — sign-in is one Google
account per workspace, and the "Team" panel is bookable staff, not logins. Canadian French. Square
Appointments. Anything implying compliance with a named regulation.

## Verification run

Recorded at the end of the pilot-hardening pass; see the dated entry below for exactly what was executed.

### 2026-11-07 — pilot hardening

To be completed when the phases in [PILOT_HARDENING_PLAN.md](PILOT_HARDENING_PLAN.md) finish. Commands,
counts and failures will be stated exactly as they ran, including anything that did not pass.

## Standing boundaries

- Supabase project `yfmoggubjsffgameexfi`. All 15 migrations are applied and recorded in the migration
  ledger; the ledger was backfilled on 2026-11-07 after three migrations had been applied outside the CLI.
- Browser-owned practice state is untrusted and replayable. It controls fictional local results only, and is
  never sufficient for approval or spending limits.
- The public `/api/live` route is deliberately closed and returns 503. Live AI is reachable only through an
  authenticated session with `live_ai_enabled` set for that workspace.
- Per-request size, schema and graph bounds constrain normal work. They are not a global abuse or hosting
  cost cap; the usage ledger is the authoritative spending control.
- Deployment status is not verified by this document.
- The project's own license is pending the owner's choice; dependencies retain their own licenses.
