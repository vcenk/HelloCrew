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
- The audit trail. Copilot actions schedule a row in `hc_audit_events` after the response, covered by unit
  tests and three mutation checks, but no production action has been confirmed to have produced one.
- Lead capture, handoff and approval flows at any volume beyond manual testing.
- Behaviour under concurrent customers in one workspace.
- The `gpt-6-luna` cost projection. The switch is deployed and the live evals pass 13/13, but no settled
  ledger rows exist for it yet, so the ~29% saving in `PRICING_STRATEGY.md` remains arithmetic, not measurement.

### Not built

Billing and Stripe. Voice and telephone. Multi-user accounts and team invites — sign-in is one Google
account per workspace, and the "Team" panel is bookable staff, not logins. Canadian French. Square
Appointments. Anything implying compliance with a named regulation.

Two pieces of Phase 5 are libraries with no caller, and should not be described as features:

- **An owner-facing view of the audit trail.** `recentAuditEvents` reads through the caller's own session so
  RLS decides what they see, and nothing calls it. The rows are being written; no screen shows them.
- **Workspace deletion in-product.** `requestDeletion` and `advanceDeletion` exist and are tested, and
  nothing reaches them. `/data-deletion` tells owners to email a person, who deletes by hand — which is a
  manual process honestly described, not an automated one, and nothing records that it happened.

## Verification run

Recorded at the end of the pilot-hardening pass; see the dated entry below for exactly what was executed.

### 2026-11-07 — pilot hardening

Executed locally on Windows against the committed tree, after the five phases in
[PILOT_HARDENING_PLAN.md](PILOT_HARDENING_PLAN.md).

| Command | Result |
| --- | --- |
| `npm run lint` | passed, no errors or warnings |
| `npm run typecheck` | passed |
| `npm test` | **894 passed, 7 skipped**, 51 files (up from 831 before this work) |
| `npm run build` | passed, compiled successfully |
| `npx playwright test` with `SKIP_AUTH_CHECK=1` | 110 passed, 23 skipped — the skipped ones are the login specs needing Supabase credentials, which is what the flag is for, and is how CI runs |
| `npx playwright test` without the flag | **133 passed**, nothing skipped, against the local Supabase variables |

**What is new and genuinely covered**

- Webhook lifecycle: 11 tests — success, duplicate delivery, a live lease refusing a second worker, failure,
  retry after failure, recovery once a lease expires, attempt counting, bounded error text, parking an
  unreadable event, and the stored payload being dropped on success.
- Conversation turns: 12 tests — a burst of five yielding exactly one winner, lease expiry and recovery, a
  human takeover mid-turn, a late worker failing to release another's lease, and failing closed when the
  lock is unreachable.
- Shared rate limiting: 10 tests — the limit holding across callers, window reset, `Retry-After`, per-visitor
  and per-installation separation, key bounding, and failing open on both an error result and a thrown error.
- Workspace deletion: 9 tests, including one that reads the migrations and fails when a tenant table exists
  that no deletion step clears.
- RLS: 202 assertions over the migration files, 14 more than before this work.

**Mutation checks run**, because a test that cannot fail proves nothing:

- Removing the conversation lock failed 4 of the 12 turn tests, including the human-takeover case.
- Stripping `tenant_id` from a new table failed 2 RLS assertions.
- A first attempt at that mutation passed, because the primary key still contained the string `tenant_id`;
  the check is a substring match and the mutation was badly chosen, not the test broken. Recorded because it
  is the kind of thing that otherwise reads as a verified guarantee.

**What these tests do not prove.** The webhook, turn-lease and rate-limit tests run against stand-ins that
encode what the SQL functions are expected to do. They pin the contract the application code relies on; they
do not execute the functions. The migrations have since been applied (see below), so the SQL has now run —
but nothing automated exercises it. The concurrency these functions exist to control has never been tested
against real Postgres, only against the stand-ins.

**CI was reviewed and not changed.** It already runs lint, typecheck, unit tests, build and Playwright, and
has no eval step, so live model calls stay out of ordinary CI as intended.

### Migrations added, and applied 2026-11-07

Applied to project `yfmoggubjsffgameexfi` before the code that uses them was pushed. Each is additive and
carries a forward-recovery note in its header.

| Migration | Adds |
| --- | --- |
| `20261107090000_webhook_event_lifecycle` | status, attempts, lease, bounded error and transient payload on `hc_webhook_events`, plus claim/complete/fail/receive/sweep functions |
| `20261107091000_conversation_turn_lease` | turn lease columns on `hc_conversations`, plus claim/release/validate functions |
| `20261107092000_shared_rate_limits` | `hc_rate_limits` and an atomic counter function |
| `20261107093000_audit_and_deletion` | `hc_audit_events` and `hc_workspace_deletions` |

**Checked against the live schema, not assumed from the files.** All ten new functions exist; `service_role`
can execute all ten and `authenticated` and `anon` can execute none; the six new `hc_webhook_events` columns
and both `hc_conversations` lease columns are present; `hc_rate_limits`, `hc_audit_events` and
`hc_workspace_deletions` all have RLS enabled *and* forced, with the intended policy counts (0, 1, 1).
`hc_claim_conversation_turn` was called against a non-existent conversation and returned null rather than
erroring, which is the case the application cannot distinguish from a refusal.

Why that last check mattered: `claimTurn` fails closed on any error, and it sits *above* the
`runPracticeTurn` fallback in `runCustomerTurn`. Had the functions been missing when this shipped, the
website widget would have stored every customer message and answered none of them — on every tenant,
whether or not live AI was on, with no error surfaced to the visitor.

**The ledger records all 19.** These four were applied outside the CLI, so
`supabase_migrations.schema_migrations` initially had no row for them — the same gap that made
`appointments.sql` look unapplied earlier the same day. Backfilled and confirmed: 19 rows, matching the 19
files by version and name. `20261107093000` is also re-runnable now, so a future `supabase db push` is safe
on both counts rather than relying on the ledger alone.

## Standing boundaries

- Supabase project `yfmoggubjsffgameexfi`. All 19 migrations are applied and recorded in the ledger. It was
  backfilled twice on 2026-11-07 — once after three earlier migrations had been applied outside the CLI, and
  again for the four added that day. Applying by hand and recording are separate steps, and the ledger is
  evidence of the second only; the schema was verified directly both times.
- Browser-owned practice state is untrusted and replayable. It controls fictional local results only, and is
  never sufficient for approval or spending limits.
- The public `/api/live` route is deliberately closed and returns 503. Live AI is reachable only through an
  authenticated session with `live_ai_enabled` set for that workspace.
- Per-request size, schema and graph bounds constrain normal work. They are not a global abuse or hosting
  cost cap; the usage ledger is the authoritative spending control.
- Deployment status is not verified by this document.
- The project's own license is pending the owner's choice; dependencies retain their own licenses.
