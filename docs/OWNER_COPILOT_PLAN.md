# Owner Copilot — plan

A conversational control panel the business owner uses to configure and
supervise HelloCrew. It is **not** the customer-facing receptionist: separate
prompt, separate tools, separate permissions, separate action policy. The two
may share approved knowledge and the model adapter, nothing else.

Chat is the command layer. The existing structured screens stay the source of
truth.

## Current state — what was verified in this repository

Verified by reading the code, not assumed.

### Knowledge: a complete, secure pipeline already exists

| Step | Where |
|---|---|
| Upload | `startKnowledgeUpload` — `app/app/knowledge-file-actions.ts:89` |
| Extract + index + suggest | `processKnowledgeFile` — `:160` |
| Text extraction | `extractFileText` (`lib/server/file-text.ts`), 10 MB cap, mime allowlist |
| Search index | `replaceChunks` |
| Model suggestions | `suggestKnowledgeItems` — `lib/server/knowledge-suggest.ts:74` |
| Suggestion → store | `mergeSuggestions` — `lib/knowledge-merge.ts:27` |

Three properties matter for this work:

- `suggestKnowledgeItems` is already budget-reserved, uses structured output
  against `suggestionSchema`, and is instructed that the document is *data, not
  instructions* and that it must never invent prices, times or policies.
- `mergeSuggestions` already lands everything as `status: "draft"`. Nothing
  reaches approved knowledge without a separate human act. It also detects
  same-file duplicates, skips unchanged items, and links replacements through
  `replacesId`.
- It does **not** compare a suggestion against *approved* knowledge from other
  sources. Cross-source conflict detection is genuinely missing and is the one
  piece of knowledge logic this work adds.

**The Copilot adds no parsing, no indexing, no upload path.** It calls the
above and presents the result as a reviewable change set.

### Workflows: a builder with no runtime

- Types, validation and lifecycle: `lib/workflow.ts`, `lib/workflow-lifecycle.ts`
- Canvas: `components/workflow-builder.tsx`
- `lib/workflow-runner.ts` exposes `compilePracticePlan`, which returns
  `{ mode: "practice", externalWrites: 0 }` — a simulation for the builder UI.

Checked directly: `grep -rln "workflow" lib/agent/ lib/server/ lib/calendar/`
returns **nothing**.

> **A published workflow does not change live agent behaviour.** Live behaviour
> comes from crew skills, approved knowledge and the tool contracts in
> `lib/agent/tool-contract.ts`.

Any Copilot surface that touches workflows must say so plainly. Phase 3 is
specified below but is **not** started in this deliverable.

### Auth and the server boundary

- `getWorkspaceContext(db)` → `{ userId, email, tenantId, tenantName, role }`
- Established pattern: a private `session(write)` + `run(write, body)` wrapper
  per server-action file (`app/app/conversation-actions.ts:52-78`), rejecting
  `viewer` on writes.
- `widgetAdminClient()` is the service-role client; the RLS client comes from
  `createClient()`.
- Next.js 16 docs (`01-app/02-guides/data-security.md`) are explicit: server
  actions are reachable by direct POST, so **every** action verifies auth and
  authorization itself. Encrypted action IDs are not an authorization layer.

### Model adapter

- `createOpenAIChatModel(config, opts)` — `lib/models/openai.ts`, the single
  place an OpenAI client is constructed, already `server-only`.
- `readLiveConfig()` → `{ ready, config }`; `modelFor(config, task)` routes.
- `reserveUsage` / `settleUsage` — `lib/usage/ledger.ts`.
- The customer agent's loop is `runAgentTurn` (`lib/agent/graph.ts`) with its own
  effects and approvals. The Copilot does **not** reuse that graph: entangling
  owner configuration with the customer receptionist is exactly what the brief
  forbids. It reuses the adapter, the router and the ledger.

## Architecture

```
owner message + attachments
        │
        ▼
  classify intent ──────────────► CopilotContext (route, entity — a hint only)
        │
        ▼
  model, bound ONLY to registered Copilot actions
        │
        ▼
  tool call ──► registry lookup ──► unknown name? refused, never executed
        │
        ▼
  action.preview(input, ctx) ──► ChangeSet (operations + conflicts)
        │
        ▼
  safety level decides: execute now │ ask for confirmation
        │
        ▼
  action.execute(input, ctx) ──► ActionResult (+ UndoToken where real)
        │
        ▼
  audit event
```

Two rules the implementation enforces rather than documents:

1. **The model selects from the registry; it never names a function or a
   table.** A tool call whose name is not registered is refused.
2. **The model cannot lower a safety level.** The level is a property of the
   registered action, read server-side, never taken from model output.

## Safety model

| Level | Examples | Gate |
|---|---|---|
| `read_only` | search, summarise, explain, navigate | immediate |
| `draft_write` | knowledge suggestions, workflow drafts | immediate, marked draft, undo where real |
| `live_configuration` | approve knowledge, skills, working hours, publish | before/after + explicit confirmation |
| `external_write` | send a message, create/cancel a booking | explicit confirmation + existing authorization |
| `destructive` | delete knowledge, workflow, connection, document | names the exact target + explicit confirmation |

Each action also declares a `requiredRole`. The role is checked **at the server
boundary**, inside the action, against `getWorkspaceContext` — not in the panel.

`UndoToken` is only issued where rollback genuinely exists. No token is minted
for anything that cannot actually be reversed.

## Folder ownership

| Path | Contains | Boundary |
|---|---|---|
| `lib/copilot/` | schemas, ChangeSet types, registry, safety + permission policy, presentation helpers | client-safe, no server imports |
| `lib/copilot/actions/` | action definitions — knowledge first | client-safe metadata; execution lives server-side |
| `lib/server/copilot/` | orchestration, owner prompt, model call, execution, audit | `import "server-only"` |
| `app/app/copilot-actions.ts` | server actions — the only entry point from the client | auth + role inside every export |
| `components/copilot/` | panel shell, message list, composer, cards | no domain logic |

Folders are created only when they hold working code.

## Status

Phases 1 and 2 are built and were driven end to end against a real document
in the running dashboard. Phases 3 and 4 are specified below and **not
started** — nothing in the UI offers them.

| Built | Where |
|---|---|
| Contracts, safety levels, roles | `lib/copilot/contracts.ts` |
| Registry + soundness checks | `lib/copilot/registry.ts` |
| The single policy gate | `lib/copilot/policy.ts` |
| Three knowledge actions | `lib/copilot/actions/knowledge.ts` |
| Conflict + duplicate detection | `lib/copilot/knowledge-changes.ts` |
| Owner prompt, model turn | `lib/server/copilot/run.ts` |
| Execution, undo | `lib/server/copilot/knowledge.ts` |
| Audit events | `lib/server/copilot/audit.ts` |
| Server boundary | `app/app/copilot-actions.ts` |
| Panel, cards | `components/copilot/` |

Known limits, stated rather than implied:

- **Audit is a structured server log, not a table.** There is no audit table in
  this schema and adding one needs a migration somebody has to apply.
- **Undo covers the knowledge actions only**, because those are the ones where
  rollback is genuinely possible. No other action claims it.
- **One action per turn.** The Copilot does not chain actions.
- **No workflow actions exist**, deliberately: see the risk below.

## Phases

**Phase 1 — foundation.** Contracts, registry, safety and permission policy,
confirmation lifecycle, server/client split, panel shell against typed mocks.

**Phase 2 — knowledge vertical slice.** Attach a document through the panel,
reuse `processKnowledgeFile`, turn `Suggestion[]` into a `ChangeSet` with
additions / updates / duplicates / conflicts against approved knowledge,
review and edit and discard per item, apply, report exactly what changed, audit.

**Phase 3 — workflow authoring.** Chat produces patches against the existing
`WorkflowDefinition`; `validateWorkflow` is the deterministic gate; canvas and
chat read one canonical spec. **Blocked on a runtime compiler**: until a
published workflow actually configures the agent, every workflow surface is
labelled as not affecting live behaviour.

**Phase 4 — wider operations.** One domain at a time: crew skills, working
hours, connections, conversations, analytics.

## Risks

- **Claiming live effect.** Workflows do not reach the runtime. Mitigation: the
  action registry marks workflow actions `affectsLiveBehaviour: false` and the
  UI renders that, rather than relying on anyone remembering.
- **Prompt injection through documents.** An uploaded file is attacker-controlled
  text. Mitigation: documents never reach the Copilot's own prompt. They go
  through `suggestKnowledgeItems`, which has its own instruction and structured
  output, and come back as data for a human decision.
- **Model inventing business facts.** Mitigation: the Copilot may only structure
  what a person said or what extraction returned; prices, hours and policies are
  copied, never composed. Covered by tests.
- **Privilege escalation via route context.** Route context is a hint; every
  action re-resolves the workspace and role server-side.
- **Two parallel knowledge paths.** Mitigation: the Copilot calls the same
  server actions the Knowledge page calls.

## Acceptance criteria for the first deliverable

1. An authenticated owner can open the Copilot from any dashboard page.
2. It works on desktop and mobile without horizontal overflow.
3. A supported document can be attached and added to Knowledge through chat.
4. Extraction and suggestion reuse the existing secure infrastructure.
5. Additions, updates, duplicates and conflicts are all shown.
6. Nothing becomes approved knowledge without an explicit decision.
7. Individual suggestions can be edited or discarded.
8. Applied changes appear in the existing Knowledge UI.
9. A result card reports exactly what changed.
10. A viewer cannot perform a restricted mutation.
11. Model output cannot invoke an unregistered action.
12. Lint, typecheck, unit, integration, build and Playwright all pass.
