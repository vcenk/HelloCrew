# Implementation phases

Status: the public website and synthetic LangGraph practice studio are implemented. The phase details below remain the target roadmap, not a claim that every acceptance criterion is complete. See the README and TESTS_EVALS for the verified current subset. Live-operation phases remain unimplemented.

## Phase 0 Confirm the project boundary

- Use only the exact authorized HelloCrew repository: `https://github.com/vcenk/HelloCrew`.
- The owner has authorized public visibility for now; ensure every published file is suitable for a public repository.
- Confirm the target branch and publishing permission; never touch another repository.
- Keep demo-only scope explicit. No real customer data, paid calls, new accounts, or live tools.
- Choose pinned, mutually compatible package versions at implementation time.

Exit: repository target and public visibility are confirmed, documentation accepted, and implementation/publication scope is clear.

## Phase 1 Build the public site and demo shell

- Create the Next.js/TypeScript foundation and reproducible package scripts.
- Build an original public landing page with the warmth of the Gaia public-site reference.
- Design an independent beginner-friendly dashboard with the specified navigation.
- Add fictional fixtures, empty states, mode labels, mobile behavior, and keyboard accessibility.
- Add a clearly marked unauthenticated demo entry point. Authentication is intentionally deferred; no private data is accepted or protected by this demo.
- Make all future integration controls visibly unavailable.

Exit: landing page and demo navigation work on desktop/mobile; no provider calls occur; no interface implies a live service; build, type, lint, and browser checks pass.

## Phase 2 Implement the deterministic agent graph

- Implement actual LangGraph nodes and the demo tool registry.
- Support grounded FAQ, unknown-answer behavior, booking link, simulated booking approval, and handoff.
- Implement demo approval state transitions, argument binding, rejection, expiry, and repeat-click protection.
- Show readable public activity and evidence; no private reasoning.
- Add interruption and reset behavior with honest persistence limits.

Exit: all fixed demo scenarios pass deterministically and trace through graph nodes. Network tests prove no model or external write adapter is invoked. Demo actions stay simulations.

## Phase 3 Finish the demonstrable product

- Refine business-information editing, assistant sections, and practice suggestions.
- Test onboarding interruption, back/forward navigation, dialogs, long content, and narrow screens.
- Verify all landing-page claims match actual implemented capability.
- Update README with working installation commands and implemented/planned status.
- Prepare a preview only after the owner authorizes deployment and its destination.

Exit: the owner can review a complete demo. The app remains safe to try without authentication because it uses only synthetic data and has no paid/external effects. This is a valid stopping point until the owner chooses a live pilot.

## Phase 4 Add the live security foundation only when requested

- Select existing or separately approved auth and durable storage resources.
- Implement owner identity, membership, visitor sessions, tenant isolation, and permission checks.
- Implement migrations, durable checkpoints, approvals, execution records, and handoff queue.
- Implement an atomic shared usage ledger with global and tenant budgets.
- Add server-side abuse/concurrency controls, retention/deletion, secret isolation, and audit logging.
- Keep provider calls disabled while these controls are incomplete.

Exit: isolation, concurrent budget, replay, recovery, and deletion tests pass against the actual durable store. Authentication is now mandatory for private administration. A local memory store cannot satisfy this phase.

## Phase 5 Enable a bounded live web pilot only when authorized

- Select provider/model, disclose data handling, configure server-side secrets securely, and approve a total spending boundary.
- Validate all readiness gates together; configure hard stops and operational ownership.
- Run a small approved evaluation set before exposing live traffic.
- Enable only approved read-only business tools and the configured booking link initially.
- Verify real usage accounting, failure behavior, kill switch, handoff, and redacted operational logs.

Exit: measured pilot results meet pre-agreed criteria, spend reconciles, unknown outcomes are handled, and a responsible person can pause and support the service. No real booking integration is implied.

## Phase 6 Add integrations based on demonstrated demand

Implement one integration at a time. A booking adapter needs verified availability, timezone handling, customer-data permission, idempotency, cancellation semantics, and confirmed results. WhatsApp and Phone follow the [channel roadmap](CHANNEL_ROADMAP.md). Do not create a generic integration catalog before a real use case justifies it.

## Release discipline

For each phase: implement, test final code, review the diff, update status docs, and publish only within authorization. A commit is not a deployment, a successful build is not a security review, and a preview is not evidence that live operation is ready. Report checks as passed, failed, or not run. Keep live flags off through every demo release.
