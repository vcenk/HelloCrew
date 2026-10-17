# HelloCrew roadmap

Status: active plan, adopted 2026-10-17. This is the working build order. The other documents describe constraints and target designs; this one says what gets built next and how we know it is done.

## Goal

HelloCrew is an agentic front desk for small, appointment-based businesses (salons, clinics, studios, local services). A business owner sets up an assistant once; the assistant answers customers from approved knowledge, takes actions through connected tools (booking, lead capture, review replies), and pauses for the owner whenever an action is risky or public.

## Where we are (audit, 2026-10-17)

| Area | Reality |
| --- | --- |
| Agent runtime | A LangGraph `StateGraph` exists, but its "provider" is a hard-coded switch over four scenarios. Free text is matched by regex and exact FAQ text. No model, no planning. |
| Workflows | The visual builder validates and topologically sorts a graph into a "test plan". Published workflows do not influence the conversation runtime. |
| Persistence | All editors use `localStorage`. The Supabase tenant schema (11 tables, forced RLS) is applied but unused. |
| Dashboard | Single 994-line `studio.tsx` with a `useState` page switch; 5.6k-line global stylesheet; heavy disclaimer copy; no dark mode. |
| Safety scaffolding | Good: strict Zod schemas, bounded bodies, same-origin checks, live route fails closed, approval idempotency within the session. |

## Decisions taken

1. **Keep LangGraph JS** as the orchestration layer. Its interrupt/resume model and Postgres checkpointer match HelloCrew's owner-approval flow. Mastra was the main alternative; the switching cost is not justified.
2. **Agent shape: supervisor + skill agents.** One supervisor routes each turn to a skill (Receptionist/FAQ, Booking, Lead & quote, Reviews). Skills share one typed tool registry; permissions and approvals are deterministic code, never model decisions.
3. **Workflows become configuration of the runtime.** A guided template is a settings object for one agent (enabled skills, approval rules, tone, handoff rules). The advanced canvas compiles to the same runtime graph.
4. **Model layer behind one adapter** (Anthropic Claude and OpenAI), with a per-workspace hard budget and a deterministic fallback when no key or budget exists.
5. **Dashboard uses real App Router routes** under `/app/*`, a token-based design system with light/dark themes, and no Tailwind (avoids a preflight conflict with the landing page stylesheet).
6. **Borrow, don't fork:** open-agent-platform (agent config schema, MCP tools), agent-inbox (approval inbox UX), agents-from-scratch-ts (triage → draft → interrupt), Chatwoot (conversation/contact data model), Cal.com API v2 (booking).

## Phases

### Phase 1 — Dashboard v2 and quick fixes (in progress)

- [x] Route-based dashboard: `/app`, `/app/inbox`, `/app/assistant`, `/app/workflows`, `/app/channels`, `/app/settings`. Legacy `?section=` links redirect.
- [x] Shared dashboard state provider (assistant identity, business facts, workflow readiness, practice conversation) that survives route changes.
- [x] Design tokens, light/dark/system theme, new sidebar, top bar, command menu (Ctrl/⌘ K), toasts, empty states.
- [x] Home: assistant badge, launch checklist, decisions queue, session numbers.
- [x] Inbox: conversation, reply trace panel, inline approvals, quick prompts.
- [x] Fixes: tolerant FAQ matching (reworded questions), best-effort per-IP rate limiting on `/api/demo` (40/min) and `/api/widget/message` (30/min).
- [x] Legacy editors (Assistant, Workflows, Channels, model routing) hosted in the new shell and themed for dark mode via generated tokens (`scripts/theme-legacy-css.mjs`).
- [x] Browser smoke test updated for the new routes (`SKIP_AUTH_CHECK=1` skips the Supabase login check when env vars are absent).
- [ ] Persist editors to Supabase when signed in (repository layer + server actions), local fallback when signed out.
- [ ] Restyle the internals of the Assistant, Workflows and Channels editors with dashboard primitives (they currently keep their original layouts).

Exit: lint, typecheck, unit tests, build and browser smoke pass; every page works on desktop and mobile in both themes.

### Phase 2 — Real agent runtime

- `lib/agent/`: supervisor graph, skill subgraphs, typed tool registry, policy gate, `interrupt()` for approvals.
- `lib/models/`: Anthropic + OpenAI adapters behind `ModelProvider`; deterministic provider kept for tests and no-key mode.
- Knowledge retrieval with pgvector (tenant- and publication-filtered), replacing keyword matching.
- `PostgresSaver` checkpoints on Supabase; approvals persisted and resumed by id.
- Usage ledger: atomic reservation per turn, hard monthly cap per workspace, fail closed.
- Eval suite: grounded answers, unknown handling, prompt-injection, multilingual (EN/FA/ZH), approval bypass attempts.

Exit: a signed-in owner can chat with their own assistant, grounded in their approved knowledge, with bookings paused for approval and spend capped.

### Phase 3 — Inbox, takeover and first integrations

- Conversations/messages/contacts tables (Chatwoot-style), live inbox, human takeover and hand-back.
- Booking via Cal.com API v2 or Google Calendar; booking-link fallback.
- Lead capture → email notification to the owner.
- Widget installations per workspace with allowed-origin list.

### Phase 4 — Channels and reputation

- Google Business Profile reviews (draft → approve → post), after policy review.
- WhatsApp Cloud API adapter.
- Voice via LiveKit Agents reusing the same tools.

## Working rules

- Every phase ships behind green `npm run check`.
- Live model calls require: verified identity, tenant ownership, budget cap, and an explicit owner opt-in.
- Update this file's checkboxes in the same PR that completes the work.
