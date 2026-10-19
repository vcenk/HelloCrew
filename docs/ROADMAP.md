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

- [x] Route-based dashboard (first version: `/app`, `/app/inbox`, `/app/assistant`, `/app/workflows`, `/app/channels`, `/app/settings`; replaced by the crew layout below). Legacy `?section=` links redirect.
- [x] Shared dashboard state provider (assistant identity, business facts, workflow readiness, practice conversation) that survives route changes.
- [x] Design tokens, light/dark/system theme, new sidebar, top bar, command menu (Ctrl/⌘ K), toasts, empty states.
- [x] Home: assistant badge, launch checklist, decisions queue, session numbers.
- [x] Inbox: conversation, reply trace panel, inline approvals, quick prompts.
- [x] Fixes: tolerant FAQ matching (reworded questions), best-effort per-IP rate limiting on `/api/demo` (40/min) and `/api/widget/message` (30/min).
- [x] Legacy editors (Assistant, Workflows, Channels, model routing) hosted in the new shell and themed for dark mode via generated tokens (`scripts/theme-legacy-css.mjs`).
- [x] Browser smoke test updated for the new routes (`SKIP_AUTH_CHECK=1` skips the Supabase login check when env vars are absent).
- [x] Persist editors to Supabase when signed in: `hc_workspace_documents` (one versioned document per editor per tenant, compare-and-swap writes, RLS), server actions in `app/app/actions.ts`, debounced autosave with a save indicator, first sign-in uploads the browser setup, workspace copy wins on load. Signed out or unconfigured, everything keeps working from browser storage.
- [x] Sign-in surfaced in the dashboard ("Sign in to save", Settings → Account, sign out); `/login?next=` returns to the dashboard; `/workspace` redirects to `/app`.
- [x] Migrations `workspace_documents` and `advisor_hardening` applied to project `yfmoggubjsffgameexfi` (2026-10-17); RLS verified on the live database in a rolled-back transaction (CAS, stale/skip writes blocked, cross-tenant and anon denied). Remaining advisor notice is intentional: checkpoints, approvals and usage reservations are server-only tables with no client policies.
- [x] Verified end to end with a real Google account (2026-10-17): sign-in, workspace provisioning, autosave of identity and knowledge to `hc_workspace_documents`.
- Note: many apps sharing `localhost:3000` can accumulate cookies until the dev server returns HTTP 431; clear `localhost` site data in the browser.
- [x] Crew redesign (2026-10-17), modeled on how Intercom Fin, Chatbase, Podium and Birdeye organize agent products: agents by job, one shared knowledge base, per-skill autonomy. Navigation is now **Today · Conversations · Crew · Knowledge** (+ Settings).
  - Today: "Needs you" (booking approvals and questions the crew couldn't answer, each with a Teach link), test-chat numbers, slim setup bar, crew strip.
  - Conversations: conversation list, test chat, "Used" chips on each reply (knowledge or skill, linking to where it is changed), "Teach this answer" when a reply had no matching knowledge, Behind the reply panel.
  - Crew: one real agent (website receptionist) plus WhatsApp, review and phone jobs shown as coming soon. Agent page with Skills (Off / Ask me first / On its own, limited to what is safe today), Personality and Channels tabs, and a Try panel. The workflow canvas stays as an "Advanced workflow editor".
  - Knowledge: grouped by kind, live/draft switch per item, add/edit/delete dialog, `?teach=` prefill, suggestions from unanswered questions, free "Check an answer" preview (no AI call), business profile.
  - Skills are enforced: new `crew` workspace document (`lib/crew.ts`, migration `20261017213940_crew_document`); the live agent only gets `request_booking` when booking is "ask" and `handoff_to_human` when handoff is on, and the prompt changes to match; practice mode follows the same settings.
  - Old routes `/app/inbox`, `/app/assistant`, `/app/channels` and `?section=` links redirect.
- [ ] Restyle the internals of the workflow editor and website-chat guide with dashboard primitives.

Exit: lint, typecheck, unit tests, build and browser smoke pass; every page works on desktop and mobile in both themes.

### Phase 2 — Real agent runtime

Progress (2026-10-17):

- [x] OpenAI behind one adapter (`lib/models/openai.ts`, default `gpt-4o-mini`, configurable by env). Anthropic adapter still to add.
- [x] LangGraph agent (`lib/agent/`): model ↔ tools loop, max 3 model rounds, policy gate that only runs registered tools with schema-checked arguments.
- [x] Tools: `search_knowledge`, `get_business_details`, `request_booking` (records an owner approval, never books), `handoff_to_human`.
- [x] Grounding: approved knowledge and identity are loaded server-side from the signed-in workspace; nothing the browser sends is used as knowledge. Prompt-injection rule in the system prompt.
- [x] Spend controls: `hc_tenant_limits` + `hc_usage_reservations` with service-role-only RPCs; atomic worst-case reservation per turn against the tenant monthly budget ($5 default) and a platform cap ($20 default); settle at measured cost; unknown outcomes stay charged. Migration `20261017152928_live_ai_usage_ledger.sql` applied.
- [x] Owner opt-in: Settings → Live AI toggle (owner only) with a month-to-date budget meter; Conversations switch between Practice and Live AI; live approvals on Today and in Conversations.
- [x] The agent reports `unanswered` when no approved knowledge matched, which drives the "Teach this answer" loop.
- [x] Server-stored conversations (2026-10-18, migration `20261018173144_conversations`): `hc_conversations`, `hc_messages`, `hc_contacts`; `hc_approvals` now belongs to a conversation and the message that proposed it. RLS: members read; owners/operators create test chats and may only add their own replies to customer chats; approvals are created by the server and decided through `hc_decide_approval` (security definer, checks the caller's role, records who decided, posts the customer reply, clears "waiting"). A trigger keeps each conversation's preview, count (max 500) and status in step.
  - `/api/agent` now takes `{conversationId, message}`; history comes from the database, so a browser can't rewrite earlier turns. Replies, usage and approvals are stored with the service role.
  - The agent rebuilds state from stored messages each turn, so resuming after an approval needs no separate graph checkpoint (`hc_checkpoints` stays unused for now).
  - Dashboard: saved conversation list with status (AI handling, Waiting for you, Needs a person, Closed), open/close/reopen/delete, **Take over** (owner replies, AI stays quiet) and **Hand back**. Today's "Needs you" reads approvals, handoffs and unanswered questions across all saved chats. Signed out, everything still works in the tab.
- [ ] pgvector retrieval once knowledge outgrows the inline prompt budget.
- [ ] Eval suite (grounding, unknowns, injection, EN/FA/ZH).

- `lib/agent/`: supervisor graph, skill subgraphs, typed tool registry, policy gate, `interrupt()` for approvals.
- `lib/models/`: Anthropic + OpenAI adapters behind `ModelProvider`; deterministic provider kept for tests and no-key mode.
- Knowledge retrieval with pgvector (tenant- and publication-filtered), replacing keyword matching.
- `PostgresSaver` checkpoints on Supabase; approvals persisted and resumed by id.
- Usage ledger: atomic reservation per turn, hard monthly cap per workspace, fail closed.
- Eval suite: grounded answers, unknown handling, prompt-injection, multilingual (EN/FA/ZH), approval bypass attempts.

Exit: a signed-in owner can chat with their own assistant, grounded in their approved knowledge, with bookings paused for approval and spend capped.

### Phase 3 — Website channel and first integrations

- [x] Conversations/messages/contacts tables, human takeover and hand-back (done in Phase 2b above).
- [x] Website chat per workspace (2026-10-18, migration `20261018174518_widget_installations`):
  - `hc_widget_installations`: one public id (`w-…`) per workspace, up to 10 allowed websites, on/off. Created and edited from Crew → Receptionist → Channels, with the install snippet and a test-page link.
  - Domain lock: `proxy.ts` sets `frame-ancestors 'self' <allowed sites>` on `/widget/w-…`, so browsers refuse to show the chat anywhere else; unknown ids get `'none'`. The public demo stays embeddable anywhere.
  - Visitors: `POST /api/widget/chat` starts an anonymous `website` conversation and returns a secret token (only its SHA-256 is stored, and the dashboard role can't read it); `GET` polls for new replies every 4 s while the chat is open. The widget remembers the chat in the visitor's browser.
  - Replies: live AI when the owner has it on and budget allows, otherwise free rule-based answers from approved knowledge (also the fallback if the model fails). Booking requests become approvals on Today; when the owner has taken over, messages are stored and the visitor sees "A team member will reply here".
  - Dashboard: website chats appear in Conversations (list refreshes every 6 s, an open website chat too); replying as the owner takes the chat over automatically.
  - Limits: 12 messages/min per visitor IP, 120/min per site, 1,000 characters per message, 500 messages per conversation, plus the monthly AI budget.
- [x] Knowledge from files (2026-10-19, migration `20261019033255_knowledge_files`):
  - Add knowledge → **Upload a file** (PDF, Word .docx, Excel .xlsx, CSV, text; up to 10 MB). The browser uploads straight to a private `knowledge` storage bucket using a one-time signed slot; the server reads the text (unpdf for PDF, built-in unzip for Word/Excel), splits it into searchable chunks (`hc_knowledge_file_chunks`, Postgres full-text), and the AI suggests items (services with prices, Q&As, hours, policies), charged to the monthly AI budget.
  - Suggestions join Knowledge as drafts linked to their file. The review dialog shows them with Approve / Edit / Discard / Approve all, lets the owner read and fix the extracted text, download the original, and allow the crew to search the full text. Delete removes the file and its items.
  - The live agent's `search_knowledge` also searches allowed files (`hc_search_file_chunks`) when items don't cover a question.
  - Not yet: scanned PDFs (need text recognition).
- [x] Knowledge from website links (2026-10-19): Add knowledge → **Website link**. The server fetches the page (direct PDFs too) with SSRF protection — public http/https on ports 80/443 only, every DNS answer checked at connect time against private, loopback, link-local and metadata ranges, redirects re-checked (max 3), 12 s timeout, 3 MB cap, 10 links/min per workspace — keeps the readable text (drops scripts, menus, footers; prefers `<main>`/`<article>`), indexes it and suggests items like a file. **Refresh** re-reads the page: unchanged pages cost nothing; changed items arrive as "update" drafts showing the current value, and approving one replaces the old item (`replacesId`). Pages that need JavaScript or a login can't be read.
- [x] Team and prices per staff member (2026-10-19). Decision: **one shared knowledge base, not one per employee** — most facts are shared, separate copies drift, customers rarely ask per person, and staff turnover would orphan knowledge. What differs per person is small and structured, so it lives on the shared items:
  - **Team** list in Knowledge (name, role, about, working/away). Away hides the person and their prices from customers; removing them removes their prices and tags.
  - Services can have **price options** per team member or named option (e.g. long hair), with time; the item's price becomes the range ("$40–$60").
  - Any item can be tagged **Applies to** specific people; a **staff filter** shows everything about one person.
  - The AI gets the team and per-person prices: it gives the range, or the exact price when the customer names someone. Search matches staff names.
  - Separate knowledge per **location** or per independent practitioner is a different need: a later "Locations" layer or separate workspaces.
- [x] Lead capture (2026-10-19, migration `20261019041441_leads`): the "Capture leads" skill (Off / On its own, on by default) gives the live AI a `capture_lead` tool. When someone wants a quote or a call back, or the AI couldn't answer, it offers a follow-up and saves name + phone or email (validated, once per turn) to `hc_leads` and the conversation's contact. New leads appear on Today with tap-to-call/email, Open chat and Contacted. Practice mode doesn't capture leads.
- [x] Owner email alerts (2026-10-19, migration `20261019041919_notification_settings`): Settings → Email alerts (send-to address, defaulting to the owner's sign-in email; booking needs OK, customer asks for a person, new lead, every new website chat). Sent with Resend when `RESEND_API_KEY` is set; only for real website chats, never for the owner's own test chats; best effort, never blocks a reply. "Send a test" checks the setup.
- [x] File/link suggestions fill per-person price rows: names matching the Team become team prices, other levels/options become named options.
- [x] Landing page and site description updated (live AI and website chat are no longer "not connected").
- Realtime updates instead of polling; email/push notice to the owner for new chats and handoffs.
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
