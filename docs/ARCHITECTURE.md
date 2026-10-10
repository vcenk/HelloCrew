# Architecture

Status: proposed. All modules and flows below require implementation and verification.

## Shape of the system

Use a single Next.js TypeScript application with clear server-only modules rather than premature microservices. Keep UI, business policy, orchestration, storage, and adapters independently testable.

Proposed source layout:

```text
app/                      Pages, layouts, route handlers
components/               Accessible UI components
lib/auth/                 Session and membership checks
lib/tenancy/              Server-derived workspace context
lib/agent/                LangGraph state, nodes, transitions
lib/policy/               Permission and approval decisions
lib/tools/                Typed registry and schemas
lib/adapters/demo/        Deterministic fixtures and simulations
lib/adapters/live/        Disabled provider/integration boundaries
lib/data/                 Tenant-scoped repositories and transactions
lib/usage/                Atomic reservations and reconciliation
lib/channels/             Normalized web and future adapter interfaces
lib/audit/                Redacted structured events
fixtures/                 Clearly fictional demonstration records
tests/                    Unit, integration, isolation, and browser tests
docs/                     Product and engineering decisions
```

Folders describe ownership, not a requirement to create empty files. Keep secrets and live adapters out of the client bundle.

## Request path

1. Validate request shape, size, origin where applicable, and idempotency key.
2. Authenticate the owner or validate a constrained visitor session; resolve workspace and conversation on the server.
3. Authorize the requested operation and verify mode, channel, assistant version, and kill switches.
4. Acquire the durable conversation/run concurrency guard for live operation.
5. Build graph state from authorized published knowledge, explicit conversation context, and policy configuration.
6. Run a bounded graph step. Demo uses deterministic intent matching; live may use a provider behind a separate budget reservation gate.
7. Validate proposed tool calls against the server's registry and schemas.
8. Persist a review requirement or execute an authorized tool with deduplication.
9. Save outcome, audit events, and usage reconciliation. Return a sanitized response.

Authorization precedes retrieval. A tenant identifier sent by the browser is a lookup hint, never proof of access.

## Graph responsibilities

LangGraph coordinates state transitions between classify, retrieve, plan, validate, request approval, execute, summarize, and handoff nodes. Business permissions remain deterministic application code. An LLM cannot grant itself a tool, tenant, approval, or spending limit.

The demo must run an actual graph and produce real graph-state transitions. Its planner and tool implementations are deterministic and its effects are simulated. This allows low-cost verification without pretending that a scripted demo is a live autonomous system.

LangGraph supports mixtures of deterministic and model-driven nodes. Using its open-source runtime does not require adopting a paid observability or deployment service. Pin the actual supported package versions during implementation and use their matching API documentation. See [official LangGraph overview](https://docs.langchain.com/oss/javascript/langgraph/overview).

## Runtime and persistence

For the demo, explicit browser-local fixture state or request-scoped in-memory state is acceptable if it contains no real private information and reset behavior is visible. Neither is an authentication boundary or shared usage ledger.

For live use, select a durable transactional store and compatible checkpointer only after checking existing resources and obtaining any necessary service authorization. The design requires durable conversations, approvals, tool execution records, usage reservations, and checkpoints. A hosted function's memory or temporary filesystem does not provide durable coordination across requests or instances.

Use a bounded request to advance execution. When a human response is needed, persist and return; do not keep a serverless request open while waiting. If later workflows exceed verified function limits, add a separately approved durable job runner rather than relying on an unfinished background promise. Consult [Vercel function limits](https://vercel.com/docs/functions/limitations) at deployment time rather than hard-coding a plan limit in this document.

## Approval resumption

Persist an approval and checkpoint with the same tenant, conversation, run, action revision, tool, canonical argument digest, and expiry. Resume only after an authorized decision is durably recorded and validated. An interrupt-capable checkpointer coordinates graph state; it does not independently enforce application authorization or transaction semantics.

LangGraph resumes can restart the interrupted node. Keep external side effects outside the approval node and guard all effectful execution with durable idempotency. See [official interrupt behavior](https://docs.langchain.com/oss/javascript/langgraph/interrupts).

## Data and adapter contracts

- Repository methods accept a verified tenant context, not arbitrary tenant strings from the model.
- Tool adapters receive validated business arguments plus server-owned execution context.
- Provider adapters return structured output and measured usage without bypassing budgets.
- Channel adapters translate inbound/outbound events without redefining business policy.
- Demo and live adapters have separate construction paths; choosing demo cannot create a live network client.
- One server-controlled runtime factory validates all live prerequisites together and fails closed.

## API conventions

Suggested routes include conversation submission, conversation retrieval, approval decisions, handoff updates, and owner configuration. Exact paths are an implementation choice. All mutation handlers validate input, authorization, CSRF/origin protections where applicable, version, and idempotency. Stable error codes distinguish unauthorized, forbidden, invalid input, stale state, approval expired, budget exceeded, unavailable integration, and temporary failure. Avoid leaking whether an inaccessible object exists.

Use client-safe data transfer objects. Next.js server placement alone is not authorization; perform checks at each server entry point and data access boundary. Reference: [Next.js data security](https://nextjs.org/docs/app/guides/data-security).

## Tradeoffs

A single application lowers operational overhead and works with the intended hosting. The durable ledger and tenant authorization add necessary complexity before paid use. A manually curated knowledge base avoids early ingestion/vector costs while remaining inspectable. Advanced channels, task queues, semantic search, and additional integrations should earn their complexity through a concrete pilot requirement.
