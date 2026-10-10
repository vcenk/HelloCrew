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
- Authentication is deliberately deferred for the demo. It is a mandatory gate before private data or live administration.
- Live AI, external writes, WhatsApp, and Phone stay disabled initially.
- Provide booking links and clearly simulated booking examples; no real booking claims without a supported integration.
- Keep tenant boundaries in the design; defer subscription billing and other broad SaaS infrastructure.
- No new paid infrastructure, account creation, or provider spending is authorized by these documents.

## Open decisions that do not block the demo

- Final landing-page copy and visual details within the approved direction.
- Exact fictional demonstration business and examples, clearly labeled.
- Pinned package versions, test tooling, and implementation folder details.
- Whether demo edits last for the session or persist locally in the browser, with a visible reset/privacy explanation.
- Which first business use case should guide a later live pilot.

## Open decisions that block live operation

- Identity provider, owner roles, visitor-session design, and support-access policy.
- Durable database/checkpointer and transactional usage ledger implementation.
- AI provider, model, current pricing, data handling, credentials, and explicit budget.
- Retention/deletion rules, privacy notice, operational incident owner, and human support route.
- Verified hosting project, environment separation, and authorized deployment/activation.
- Any real booking, messaging, or voice provider and its permitted data/actions.

## Implementation status register

| Capability | Status |
| --- | --- |
| Project Markdown specifications | Drafted in this package |
| Public landing page | Planned |
| Dashboard and onboarding | Planned |
| Deterministic LangGraph demo | Planned |
| Tool approval and handoff UI | Planned |
| Authentication and tenant enforcement | Deferred until live foundation |
| Durable storage/checkpoints/usage ledger | Required before live; not implemented |
| Paid model invocation | Disabled by design; not implemented |
| Real booking | Unsupported until a verified integration exists |
| WhatsApp and Phone | Planned future adapters; disabled |
| Deployment | Not performed by this package |

## Technical references checked

- [LangGraph JavaScript overview](https://docs.langchain.com/oss/javascript/langgraph/overview): orchestration runtime and deterministic/model-driven composition.
- [LangGraph interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts): persistence and resume behavior.
- [Next.js data security](https://nextjs.org/docs/app/guides/data-security): server boundaries and authorization considerations.
- [Vercel function limits](https://vercel.com/docs/functions/limitations): verify actual deployment constraints when implementing.
- [Gaia public website](https://gaiababy.app/): public visual reference; no signed-in dashboard was reviewed.

References were reviewed for this planning package on 2026-10-10. Exact APIs, packages, provider rules, and limits must be rechecked when implemented. Project-specific controls and schemas in these files are design requirements, not claims that an upstream framework supplies them automatically.
