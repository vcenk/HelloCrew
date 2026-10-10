# Tests and evaluations

Status: future comprehensive test specification plus implemented demo checks. The demo now has Vitest coverage for typed tool validation, graph results, approval isolation/idempotence/rejection, final-turn approvals, tracing/verbose fail-closed behavior, malformed input, turn cap, API byte/origin limits, and disabled live mode. See VERIFICATION.md for executed results. Production identity, concurrency, durable storage, and live-provider tests below remain planned.

## Test layers

- **Unit:** Intent rules, schemas, policy decisions, canonical argument digests, state reducers, cost calculations, and safe formatting.
- **Graph integration:** Real graph transitions using deterministic planner and adapters.
- **Data integration:** Transactions, composite tenant constraints, durable checkpoint ownership, and idempotency on the selected store.
- **Browser:** Landing page, onboarding, practice chat, approval, handoff, settings, and responsive navigation.
- **Security:** Authorization, cross-tenant access, untrusted-content injection, secret exposure, abuse, and replay.
- **Live evaluation:** Small explicitly authorized provider runs only after all live prerequisites pass; record real costs and failures.

Choose test libraries that fit the pinned application version. Intended package scripts include type checking, linting, unit/integration tests, browser tests, and production build; document actual script names after implementation rather than presenting uncreated commands as executable today.

## Deterministic scenario suite

| Scenario | Expected result |
| --- | --- |
| Approved FAQ question | Exact supported fact with source reference |
| Missing fact | Admit missing knowledge; no fabricated hours, price, or policy |
| Conflicting records | Ask for clarification or hand off; do not invent resolution |
| Booking link request | Return configured safe URL; never say booked |
| Missing booking URL | Explain unavailable path and offer configured human route |
| Simulated booking | Review exact fictional details; label result as simulated |
| Reject or expire approval | No tool effect; clear status |
| Change approved arguments | Invalidate approval and create a fresh review |
| Double-click or replay approval | One execution intent and at most one effect |
| Explicit human request | Recorded handoff and accurate public state |
| Human takeover during run | No later autonomous effect slips through |
| Unknown intent | Safe limited answer or handoff |
| Graph step/time limit | Stop predictably and preserve diagnostic status |
| Provider key present in demo | Zero provider network calls |

## Security and tenant isolation

Test every read, mutation, stream, resume, approval, checkpoint, export, cache key, and tool against two tenants. Use valid sessions with wrong-tenant object IDs, stale roles, deleted memberships, mixed-tenant relationships, and forged client context. Verify both denial and absence of leaked existence/content information.

Inject “ignore instructions,” forged approval text, alternate tenant IDs, tool names, and data-exfiltration requests through visitor messages, knowledge, and tool outputs. The policy result must be unchanged by those instructions. Test XSS payloads, unsafe URLs, oversized input, malformed JSON, unexpected schema keys, unsupported MIME types if uploads are added, and accidental client secret imports.

## Concurrency and recovery

- Concurrent requests near a budget boundary cannot reserve beyond global or tenant limits.
- Multiple instances observe the same durable usage ledger and rate/concurrency policy.
- Process restart does not lose pending approvals, execution intent, or unsettled reservations.
- Two resumes of the same checkpoint produce one authorized state transition.
- A provider timeout after submission leaves cost/effect reconciliation pending, not automatically released or retried.
- Lease expiry fences the old worker; stale writes are rejected.
- Settling usage twice does not double-count or refund twice.
- Approval expires while the page is open; clicking later cannot execute.
- Permission or tool configuration changes between approval and execution are enforced.
- Duplicate channel events and outbound retries cannot cause duplicate real-world effects.

A single-process unit test cannot prove distributed atomicity. Run these against the intended durable backend before live launch.

## Browser and accessibility matrix

Test desktop and narrow mobile layouts, keyboard-only use, visible focus, zoom, screen-reader labels/status, reduced motion, long content, empty states, and low-bandwidth failure. Include repeated clicks, back/forward, refresh, closing and reopening dialogs, navigation during save, reset cancellation, and returning after an interrupted onboarding step. The unauthenticated demo must consistently show its mode and accept no real private business/customer workflow.

## Live evaluation design

Create a reviewed dataset of business questions, allowed actions, missing-information cases, handoff cases, and adversarial prompts. Synthetic examples come first; use real data only with authorization and minimization. Evaluate factual grounding, correct tool selection, authorization correctness, unsupported-action refusal, handoff accuracy, latency, token usage, and cost per successful task. Compare against a deterministic baseline.

Safety-critical gates require no observed cross-tenant access, unauthorized action, approval bypass, or budget bypass in the defined suite. This is a release criterion, not a guarantee of universal safety. Establish quality/latency targets before the pilot rather than inventing favorable metrics afterward.

## Evidence and release report

Record commit SHA, environment, dependency versions, fixture version, test suite, timestamp, passed/failed/skipped counts, known limitations, and any authorized live spend. Store redacted failure examples. A release report must not claim tests passed if they were merely planned or if only a subset ran. Link failures to the relevant issue or follow-up task once those records exist.
