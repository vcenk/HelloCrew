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
- Authentication is deliberately deferred for the demo. Supabase Auth with Google sign-in is the selected direction and remains a mandatory gate before private data or live administration.
- Live AI, external writes, WhatsApp, and Phone stay disabled initially.
- Provide booking links and clearly simulated booking examples; no real booking claims without a supported integration.
- Build a multi-tenant SaaS for salons, clinics, and similar appointment-based businesses. Each business has its own account and workspace.
- Use Supabase Postgres, Storage, Auth, and pgvector as the intended data platform, subject to project connection and security review.
- Use a visual node system to configure reusable LangGraph agents. Client-facing templates stay guided; an advanced builder remains available for managed setup.
- Combine website imports, manually entered services/FAQs, and uploaded documents as knowledge sources.
- Start in English, Farsi, and Mandarin, with quality evaluations before live use.
- Start with website chat, followed by dashboard management, WhatsApp, and phone/voice adapters.
- Prefer Phorest integration where a customer already uses it, and provide a calendar/link fallback for customers without a supported booking system.
- There is no free commercial tier. Subscription, onboarding, and integration are managed before customers use live service.
- No new paid infrastructure, account creation, or provider spending is authorized by these documents.

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

## Implementation status register

| Capability                               | Status                                                                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Project Markdown specifications          | Drafted in this package                                                                                                           |
| Public landing page                      | Implemented at `/`, original warm design                                                                                          |
| Dashboard and onboarding                 | Implemented at `/app`, beginner practice navigation                                                                               |
| Visual workflow builder                  | Implemented as a browser-local salon template with typed validation; publishing is disabled                                       |
| Deterministic LangGraph demo             | Implemented: editable fictional business information, bounded free-text retrieval, quick prompts, typed tools, bounded StateGraph |
| Tool approval and handoff UI             | Implemented for disposable synthetic demo only                                                                                    |
| Authentication and tenant enforcement    | Deferred until live foundation                                                                                                    |
| Durable storage/checkpoints/usage ledger | Required before live; not implemented                                                                                             |
| Paid model invocation                    | Disabled by design; not implemented                                                                                               |
| Real booking                             | Unsupported until a verified integration exists                                                                                   |
| WhatsApp and Phone                       | Planned future adapters; disabled                                                                                                 |
| Deployment                               | Not performed by this package                                                                                                     |

## Technical references checked

- [LangGraph JavaScript overview](https://docs.langchain.com/oss/javascript/langgraph/overview): orchestration runtime and deterministic/model-driven composition.
- [LangGraph interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts): persistence and resume behavior.
- [Next.js data security](https://nextjs.org/docs/app/guides/data-security): server boundaries and authorization considerations.
- [Vercel function limits](https://vercel.com/docs/functions/limitations): verify actual deployment constraints when implementing.
- [Gaia public website](https://gaiababy.app/): public visual reference; no signed-in dashboard was reviewed.

References were reviewed for this planning package on 2026-10-10. Exact APIs, packages, provider rules, and limits must be rechecked when implemented. Project-specific controls and schemas in these files are design requirements, not claims that an upstream framework supplies them automatically.
