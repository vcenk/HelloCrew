# Architecture

> Target runtime adopted 2026-10-17 is summarized under "Agent runtime (target)" below; build order is in [ROADMAP.md](ROADMAP.md).

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
6. Run a bounded graph step. Demo uses deterministic intent matching; live may use a server-side provider adapter behind a separate budget reservation gate. The channel calls a stable HelloCrew response contract and never chooses OpenAI, Anthropic, a model ID, or a fallback itself.
7. Validate proposed tool calls against the server's registry and schemas.
8. Persist a review requirement or execute an authorized tool with deduplication.
9. Save outcome, audit events, and usage reconciliation. Return a sanitized response.

Authorization precedes retrieval. A tenant identifier sent by the browser is a lookup hint, never proof of access.

## Graph responsibilities

LangGraph coordinates state transitions between classify, retrieve, plan, validate, request approval, execute, summarize, and handoff nodes. Business permissions remain deterministic application code. An LLM cannot grant itself a tool, tenant, approval, or spending limit.

The demo must run an actual graph and produce real graph-state transitions. Its planner and tool implementations are deterministic and its effects are simulated. This allows low-cost verification without pretending that a scripted demo is a live autonomous system.

LangGraph supports mixtures of deterministic and model-driven nodes. Using its open-source runtime does not require adopting a paid observability or deployment service. Pin the actual supported package versions during implementation and use their matching API documentation. See [official LangGraph overview](https://docs.langchain.com/oss/javascript/langgraph/overview).

Model policy is workspace/server configuration, not assistant identity, workflow structure, or channel configuration. OpenAI and Anthropic adapters must implement the same bounded request/reply contract, keep credentials server-only, declare model/capability metadata, and pass the same safety and evaluation suite. Provider switching must not require changing the installed widget. Fallbacks remain empty until cost limits, retry semantics, data handling, and failure behavior are explicitly approved.

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

## Agent runtime (target, adopted 2026-10-17)

The current `lib/demo.ts` graph is a deterministic switch and is kept only for tests and no-key practice mode. The production runtime replaces it:

```text
Channel (widget / WhatsApp / reviews) -> Conversation API -> Agent runtime
Agent runtime = LangGraph supervisor graph
  |- Receptionist skill   (knowledge search, FAQ, hours, services)
  |- Booking skill        (availability + booking tools -> interrupt() for owner approval)
  |- Lead & quote skill   (capture contact, quote -> notify owner)
  |- Review skill         (draft reply -> interrupt() for owner approval)
Tool registry  = one typed registry (Zod schemas, effect level, approval policy, integration, idempotency key)
Policy gate    = deterministic code between the model's proposed call and execution
Model layer    = ModelProvider adapters (Anthropic, OpenAI, deterministic) + per-workspace budget
Memory         = PostgresSaver checkpoints (thread = conversation id) + pgvector knowledge chunks
```

Proposed layout:

```text
lib/agent/graph.ts          supervisor + skill subgraphs
lib/agent/skills/*.ts       one module per skill (prompt, allowed tools)
lib/agent/tools/registry.ts tool definitions, schemas, effect + approval metadata
lib/agent/policy.ts         allow/deny/needs-approval decision for each proposed call
lib/models/*.ts             provider adapters behind ModelProvider
lib/data/*.ts               tenant-scoped repositories (Supabase, RLS)
```

Workflows compile into this runtime: a guided template becomes configuration (enabled skills, approval rules, tone, handoff rules); the advanced canvas compiles to the same graph. A workflow can never grant a tool that the registry or policy gate does not allow.

## Dashboard structure (v3, crew)

```text
app/app/layout.tsx                      DashboardProvider + DashboardShell (sidebar, top bar, command menu, toasts)
app/app/page.tsx                        Today (redirects legacy ?section= links)
app/app/conversations/page.tsx          Conversations (test chat, used chips, teach loop, reply trace)
app/app/crew/page.tsx                   Crew (agents by job; coming-soon jobs)
app/app/crew/receptionist/layout.tsx    Agent page: header, tabs, Try panel
app/app/crew/receptionist/{page,personality/page,channels/page}.tsx   Skills, Personality, Channels
app/app/knowledge/page.tsx              Shared knowledge (?teach= prefills a Q&A)
app/app/{workflows,settings}/page.tsx   Advanced workflow editor, settings
app/app/{inbox,assistant,channels}      redirects to the new routes
components/dashboard/                   provider, shell, ui, home, conversations, chat-thread, crew, knowledge, settings, editors
lib/crew.ts                             crew document: jobs, skills, autonomy modes (off / ask / auto)
lib/conversations.ts                    shared conversation types, status rules, message metadata schema
lib/data/conversations.ts               server-only reads/writes for conversations, messages, approvals
app/app/conversation-actions.ts         server actions: list, open, save, take over/hand back/close, decide, needs-you
components/dashboard/use-conversations.ts   client state for the open conversation and the saved list
components/dashboard/website-chat.tsx   website chat setup (allowed sites, snippet, on/off)
lib/server/agent-turn.ts                one stored AI turn (live with budget, or rule-based), shared by dashboard and widget
lib/server/widget-installations.ts      public widget lookup (service role, 30 s cache), visitor tokens
lib/server/widget-csp.ts + proxy.ts     per-installation frame-ancestors for /widget/*
app/api/widget/chat/route.ts            visitor messages (POST) and reply polling (GET)
app/app/knowledge-file-actions.ts       file upload slot, read + index + suggest, review updates, delete
lib/server/file-text.ts                 PDF/Word/Excel/CSV/text extraction, chunking, safe search query
lib/server/fetch-page.ts                SSRF-safe page fetch (connect-time DNS check, redirects, caps) and HTML-to-text
lib/knowledge-merge.ts                  merges suggestions into Knowledge as drafts or proposed updates
lib/server/knowledge-suggest.ts         AI suggestions from a document (budgeted, structured output)
components/dashboard/knowledge-files.tsx    file cards, upload flow, review dialog
app/app/dashboard.css                   dashboard tokens and components, scoped to .dash
app/app/legacy-dark.css                 generated dark palette for legacy editors (scripts/theme-legacy-css.mjs)
```

Conversations are stored per workspace. The live agent route accepts only the new customer message and reads earlier turns from `hc_messages`; its reply, cost and any approvals are written with the service role. Practice replies (computed in the browser session) and owner messages are saved through server actions under RLS. Owner decisions go through `hc_decide_approval`.

Skill modes are data, not prompt text alone: `lib/agent/tools.ts` only registers the tools a skill allows, `lib/agent/prompt.ts` states the same rules, and the provider applies them in practice mode. A mode that needs an integration that does not exist yet (booking "On its own" needs a calendar) cannot be selected.
