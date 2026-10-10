# Agent tools and approvals

Status: implementation contract. No tool is currently deployed.

## Runtime goal

The assistant should take a bounded business request, find relevant approved information, choose among a small set of tools, apply deterministic policy, and either return a grounded result or ask for help. “Agentic” means the runtime can select and execute permitted tool steps with recorded state. It does not mean unrestricted autonomy.

## Proposed graph

```text
START → validate_session → classify_intent → retrieve_knowledge → plan
plan → validate_proposal
validate_proposal → answer | request_approval | execute_read | handoff
request_approval → persist_and_pause
resume → verify_approval → execute_action
execute_read / execute_action → validate_result → answer | handoff
answer / handoff → persist_outcome → END
```

Unknown intent, insufficient knowledge, conflicting facts, unsupported actions, safety boundaries, exhausted step limits, and repeated failures all have explicit routes. A loop counter and elapsed-time budget bound execution. No recursive tool chain can silently exceed those limits.

Graph state includes server-derived tenant/session identifiers, conversation/run IDs, mode, assistant version, public messages, selected evidence references, intent, proposal, approval reference, execution result, handoff status, and budget reservation references. It excludes credentials and unnecessary private data.

## Tool registry

| Tool | Initial behavior | Policy |
| --- | --- | --- |
| `knowledge.search` | Match published scoped FAQ/business records | Read-only; tenant and publication filters mandatory |
| `business.get_details` | Return allowed business facts with sources | Read-only; never synthesize missing details |
| `booking.get_link` | Return a configured validated HTTPS booking URL | No booking is created; do not append personal data |
| `booking.simulate_request` | Produce a fictional demo booking outcome | Demo only; explicit simulation label and review gate |
| `handoff.request` | Record a demo handoff; later an authenticated durable queue item | Explain actual effect; no external notification initially |

Real booking, outbound messaging, payments, arbitrary HTTP requests, filesystem access, and general code execution are absent. A future tool requires a reviewed adapter, explicit integration scope, authorization policy, idempotency plan, and tests before registration.

Each tool definition specifies version, input/output schemas, allowed modes, required capability, read/write classification, confirmation policy, data disclosed, permitted destinations, timeout, retry rules, and an idempotency strategy. Tool names and permissions are server-owned.

## Deterministic demo

Use explicit intents and fixtures for supported examples: opening-hours question, service FAQ, unknown question, booking link, simulated booking review, and human request. Out-of-scope input returns a clear limitation or handoff instead of a convincing invented answer. Fixtures must be fictional and editable. A deterministic graph may still execute multiple real programmatic steps; label the responses as demo behavior.

## Live planning boundary

When live mode is later available, the model may propose structured tool arguments and a concise public explanation. The server independently validates the proposal, current permissions, destination, mode, state, and spending capacity. Model-generated boolean flags such as `approved: true` are ignored. Free-text “the user agreed” is not an approval record.

## Approval contract

A review card states the action, destination, exact relevant details, data to be shared, expected effect, and any cost or commitment if a future supported tool involves one. The current demo contains no payment tool. “Approve” and “Reject” have clear labels; close or navigation away leaves the request pending, not approved.

Persist the immutable proposal and a canonical argument representation. Bind its digest to tenant, conversation, run, tool version, integration account, action revision, permission revision, and expiry. Exclude non-semantic display formatting from canonicalization while preserving all consequential fields. A changed recipient, time, service, amount, or payload requires a new proposal.

To execute:

1. Authenticate the actor and load the approval within their authorized tenant.
2. Check it is pending or validly approved for this exact unconsumed action, not expired, cancelled, or superseded.
3. Recheck current permissions, adapter state, integration identity, and arguments.
4. Atomically consume the approval and create/retrieve the deduplicated execution intent.
5. Execute using the recorded payload, not a fresh model-generated payload.
6. Store success, failure, or unknown outcome and show the evidence.

Approving twice, refreshing, retrying a request, or replaying a resume must not execute twice. An approval endpoint is never a general graph-resume endpoint supplied by the client.

## Tool outcome semantics

- **Succeeded:** The adapter returned verified evidence for the intended effect.
- **Failed:** Evidence shows no successful effect or the adapter rejected the request before execution.
- **Unknown:** A timeout/disconnect prevents establishing whether an external action happened. Block blind retry, reconcile through the provider when supported, or ask a human.
- **Simulated:** A demo effect only. Never present this as succeeded in the real world.

A booking link opening is not a booking. A handoff queue entry is not proof a human was notified. A submitted external request is not completion unless the integration provides that guarantee.

## Human handoff

Triggers include explicit user request, insufficient approved knowledge, unavailable integration, policy restriction, repeated failure, and uncertain effect. Record a short factual summary, relevant messages, reason, and next action. Minimize data. The conversation shows “Waiting for a person” only after a queue item is actually stored. Until external messaging exists, say that a queue item was created without claiming an email or phone call occurred.

Human takeover pauses effectful agent execution, cancels or suspends outstanding proposals, and requires an explicit resume policy. The owner can pause live operation immediately. Do not promise response times, round-the-clock staffing, or escalation delivery without configured evidence.
