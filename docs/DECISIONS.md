# Decisions and open questions

Status: planning baseline for HelloCrew. Update this record when a decision changes; do not silently turn a proposal into an implemented capability.

## Confirmed project direction

- Project name: **HelloCrew**.
- Target repository: **https://github.com/vcenk/HelloCrew**.
- The owner allows the repository to be **public for now**. Publish only intended project material, with no secrets, private client records, or unrelated repository content.
- Do not modify any other repository.
- Build a separate original public website inspired by the warmth of gaiababy.app's public website. The dashboard can be independently designed and should be beginner-friendly.
- Use Next.js/TypeScript and the existing intended Vercel Pro hosting arrangement.
- Use open-source LangGraph JS for orchestration without paid LangSmith.
- Start with a deterministic demo using fictional data and simulated actions.
- Authentication remains optional for the public demo. Supabase SSR Auth with Google OAuth/PKCE is implemented for the owner workspace; provider/dashboard redirect configuration and a real-account sign-in still require environment verification before private data is accepted.
- Live AI, external writes, WhatsApp, and Phone stay disabled initially.
- Provide booking links and clearly simulated booking examples; no real booking claims without a supported integration.
- Build a multi-tenant SaaS for salons, clinics, and similar appointment-based businesses. Each business has its own account and workspace.
- Use Supabase project `yfmoggubjsffgameexfi` for Postgres and Auth. The tenant foundation is applied with forced RLS. Storage and pgvector remain intended additions subject to their own policies and tests.
- Use a visual node system to configure reusable LangGraph agents. Client-facing templates stay guided; an advanced builder remains available for managed setup.
- Combine website imports, manually entered services/FAQs, and uploaded documents as knowledge sources.
- Start in English, Farsi, and Mandarin, with quality evaluations before live use.
- Start with website chat, followed by dashboard management, WhatsApp, and phone/voice adapters.
- Prefer Phorest integration where a customer already uses it, and provide a calendar/link fallback for customers without a supported booking system.
- Add Google review management as a reputation workflow: draft multilingual business replies, require approval before posting, and create internal follow-up tasks for low ratings or sensitive topics. The assistant cannot alter a customer rating.
- There is no free commercial tier. Subscription, onboarding, and integration are managed before customers use live service.
- No new paid infrastructure, account creation, or provider spending is authorized by these documents.

## Decisions adopted 2026-10-17

- Keep LangGraph JS; restructure into a supervisor graph with skill agents, a typed tool registry and a deterministic policy gate (see ARCHITECTURE "Agent runtime").
- Workflows are configuration for the runtime, not a separate execution engine.
- Model access through one `ModelProvider` contract for Anthropic and OpenAI, with a per-workspace hard budget.
- Dashboard v2: App Router routes under `/app/*`, scoped design tokens with light/dark themes, no Tailwind (avoids global preflight conflicts with the landing page). The landing page is unchanged.
- Reference projects to borrow patterns from (not fork): langchain-ai/open-agent-platform, langchain-ai/agent-inbox, langchain-ai/agents-from-scratch-ts, Chatwoot, Cal.com API v2.
- Practice test conversation persists in `sessionStorage` for the tab, so navigating or refreshing no longer loses it. It remains untrusted, disposable practice state.

## Open decisions that do not block the demo

- Final landing-page copy and visual details within the approved direction.
- Demo uses a fictional creative studio, fictional $40 USD studio visit, and fictional weekday hours.
- Implemented with npm lockfile, Vitest unit/integration tests, and Next.js App Router.
- Demo state is in-memory in one browser tab and resets on refresh; never trusted for live operations.
- The first template is salon reception: business questions, multilingual replies, booking requests with approval, and human handoff.

## Open decisions that block live operation

- Exact workspace roles, visitor-session design, and support-access policy.
- Durable database/checkpointer and transactional usage ledger implementation.
- Exact OpenAI model after multilingual evaluation, current pricing, data handling, credentials, and explicit budget.
- Retention/deletion rules, privacy notice, operational incident owner, and human support route.
- Verified hosting project, environment separation, and authorized deployment/activation.
- Any real booking, messaging, or voice provider and its permitted data/actions.
- Google Business Profile access and tenancy design. Google requires prior specific client authorization for review replies and restricts automatic third-party use and content storage, so a live implementation needs a policy review, manual sign-in, revocation flow, and possibly client-owned API projects before activation.

## Implementation status register

| Capability                               | Status                                                                                                                                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project Markdown specifications          | Drafted in this package                                                                                                                                                             |
| Public landing page                      | Implemented at `/`, original warm design                                                                                                                                            |
| Dashboard and onboarding                 | Implemented at `/app`, beginner practice navigation                                                                                                                                 |
| Visual workflow builder                  | Browser-local drafts, immutable versions, lifecycle/archive state, safe test plans, four guided templates, allowlisted node jobs, advanced canvas, and typed validation implemented |
| Business knowledge manager               | Browser-local service/FAQ/hours/policy sources, document preview, EN/FA/ZH metadata, approval lifecycle, and zero-cost retrieval test implemented; durable ingestion deferred       |
| Google review assistant                  | Guided draft/approval/follow-up workflow implemented locally; OAuth, notifications, API access, storage, and live posting deferred                                                  |
| Deterministic LangGraph demo             | Implemented: editable fictional business information, bounded free-text retrieval, quick prompts, typed tools, bounded StateGraph                                                   |
| Tool approval and handoff UI             | Implemented for disposable synthetic demo only                                                                                                                                      |
| Website widget delivery                  | Working script loader, isolated iframe, fixed public demo installation, grounded practice endpoint, and desktop/mobile test site implemented; tenant publishing and origin authorization deferred |
| AI model routing                         | Practice engine active; server-only OpenAI and Anthropic adapter slots defined; provider connection, model selection, budgets, and fallback remain disabled                         |
| Authentication and tenant enforcement    | Supabase SSR/Google OAuth code, protected owner route, workspace provisioning trigger, membership policies, and forced RLS implemented; real-account/provider verification pending |
| Durable storage/checkpoints/usage ledger | Tenant tables applied; browser-local editors, transactional checkpoint/approval operations, and atomic usage reservation functions not implemented                                 |
| Paid model invocation                    | Disabled by design; not implemented                                                                                                                                                 |
| Real booking                             | Unsupported until a verified integration exists                                                                                                                                     |
| WhatsApp and Phone                       | Planned future adapters; disabled                                                                                                                                                   |
| Deployment                               | Not performed by this package                                                                                                                                                       |

## Technical references checked

- [LangGraph JavaScript overview](https://docs.langchain.com/oss/javascript/langgraph/overview): orchestration runtime and deterministic/model-driven composition.
- [LangGraph interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts): persistence and resume behavior.
- [Next.js data security](https://nextjs.org/docs/app/guides/data-security): server boundaries and authorization considerations.
- [Vercel function limits](https://vercel.com/docs/functions/limitations): verify actual deployment constraints when implementing.
- [Google Business Profile API](https://developers.google.com/my-business/reference/rest): review listing and reply operations.
- [Google Business Profile notifications](https://developers.google.com/my-business/content/notification-setup): new and updated review delivery through Cloud Pub/Sub.
- [Google Business Profile API policies](https://developers.google.com/my-business/content/policies): client authorization, third-party access, revocation, automation, and content-retention constraints.
- [Gaia public website](https://gaiababy.app/): public visual reference; no signed-in dashboard was reviewed.

References were reviewed for this planning package on 2026-10-10. Exact APIs, packages, provider rules, and limits must be rechecked when implemented. Project-specific controls and schemas in these files are design requirements, not claims that an upstream framework supplies them automatically.
