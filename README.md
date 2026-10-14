# HelloCrew

A welcoming workspace for business owners to set up, test, and supervise an AI assistant that can answer questions and use approved business tools.

**Status: implemented practice prototype plus authenticated owner foundation, not live AI.** The public website is at `/`; the beginner-friendly studio is at `/app`; Google OAuth starts at `/login`; and `/workspace` is protected by a verified Supabase session and tenant RLS. A real LangGraph graph runs deterministic tools against fictional sample data. Durable editor saves, real customers, paid model calls, and external actions are not supported yet.

## Start here

1. Read [Product requirements](docs/PRODUCT_REQUIREMENTS.md) for the first release and its boundaries.
2. Read [UX and onboarding](docs/UX_ONBOARDING.md) for the dashboard, navigation, and setup journey.
3. Follow [Implementation phases](docs/IMPLEMENTATION_PHASES.md) to build a safe demo before enabling live AI.
4. Use [Architecture](docs/ARCHITECTURE.md), [Agent and tools](docs/AGENT_TOOLS_APPROVALS.md), and [Data model](docs/DATA_MODEL.md) together when implementing the runtime.

## The first useful experience

A business owner edits fictional business information, and tries a free-text conversation in a clearly labeled demo. This synthetic demo does not require authentication; real private data and live operations require the later security foundation. They can see which information was used, review a simulated action, and practice handing a conversation to a human. The sample booking pauses for approve/decline and only changes disposable demo state; no real reservation is made.

The public landing page takes original visual inspiration from Gaia’s public website. The dashboard is independently designed and should feel approachable to someone who has never configured an AI product. Its navigation follows Overview → Build → Test → Launch → Manage: Home is the map; Your assistant owns assistant identity, business context, and approved knowledge; Workflows owns behavior; Conversations owns customer-experience testing; Channels owns publishing and installation; Settings owns practice controls. The current section is deep-linked in the URL. The workflow library provides guided salon, clinic, service-business, and Google-review templates plus an advanced canvas. Each node explains its registered job and exposes bounded business settings. Users can dry-run a safe execution plan and publish immutable browser-local practice versions without activating outside services.

## Technology decisions

- Next.js and TypeScript for the web application and server boundary.
- Open-source LangGraph JS for an actual stateful tool graph, including deterministic demo execution.
- Existing Vercel Pro hosting as the intended deployment target. Existing subscription coverage is not a guarantee of zero incremental cost.
- No paid LangSmith service, AI subscription, new infrastructure account, or billing system is required for the initial demo.
- Web first. WhatsApp and telephone adapters remain disabled future work.
- Supabase Auth/Postgres is connected to project `yfmoggubjsffgameexfi`. The first migration adds tenant membership, workflow/knowledge versioning, forced RLS, and deny-all server-control tables.
- Live AI remains disabled until durable checkpoints/approvals, an atomic usage ledger, visitor abuse controls, provider setup, and explicit spending limits are implemented and tested.

## Documentation map

| Document                                                           | What it decides                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------------- |
| [Product requirements](docs/PRODUCT_REQUIREMENTS.md)               | Users, scope, outcomes, acceptance criteria                   |
| [Architecture](docs/ARCHITECTURE.md)                               | Boundaries, runtime, deployment design                        |
| [Data model](docs/DATA_MODEL.md)                                   | Tenant ownership, records, constraints, lifecycles            |
| [Security and privacy](docs/SECURITY_PRIVACY.md)                   | Threats, permissions, data handling, launch gates             |
| [Agent tools and approvals](docs/AGENT_TOOLS_APPROVALS.md)         | Graph, tool registry, confirmations, handoff                  |
| [UX and onboarding](docs/UX_ONBOARDING.md)                         | Navigation, page behavior, accessible states                  |
| [Implementation phases](docs/IMPLEMENTATION_PHASES.md)             | Ordered work and exit criteria                                |
| [Tests and evaluations](docs/TESTS_EVALS.md)                       | Functional, safety, concurrency, and usability checks         |
| [Deployment and configuration](docs/DEPLOYMENT_ENV.md)             | Proposed environment contract and release runbook             |
| [Cost controls](docs/COST_CONTROLS.md)                             | Limits, reservations, reconciliation, fail-closed rules       |
| [Research and unit economics](docs/RESEARCH_AND_UNIT_ECONOMICS.md) | Repositories, platform choices, channel flows, costs, pricing |
| [Channel roadmap](docs/CHANNEL_ROADMAP.md)                         | Web first and later messaging/voice adapters                  |
| [Decisions and open questions](docs/DECISIONS.md)                  | Fixed constraints and unresolved choices                      |

## Run locally

Requires Node.js 22.12+ (verified with Node.js 24).

```sh
npm ci
npm run dev
```

Open http://localhost:3000 for the website and http://localhost:3000/app for the practice studio. No environment variables or model keys are needed for those public demo routes. `/login` and `/workspace` require the three public Supabase/site variables documented in `.env.example`; no Supabase secret key is used by the app.

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm start
```

## Verification

A clean `npm ci`, ESLint, TypeScript, unit/integration tests, production build, and desktop/mobile Chrome smoke flow were run in the implementation workspace. See [verification results](docs/VERIFICATION.md). The browser flow covers the conversation demo and the visual workflow canvas, including responsive overflow and page-error checks.

The optional browser smoke test is ready to run on a suitable machine with the app at localhost:3000:

```sh
npx playwright install chromium
npm run test:browser
```

Alternatively set `CHROMIUM_PATH` to an already installed Chromium executable. The test covers desktop/mobile layout, all four scenarios, approve/decline, reset, refresh, and navigation. It saves review screenshots under `/tmp`. Use `BASE_URL` for a non-default local server URL.

## Implemented boundaries

- Editable sample business profile, services, FAQs and booking link, with bounded free-text practice and quick prompts. Fictional inputs only; no customer PII. See [next-step implementation](docs/BACKEND_NEXT_STEP.md).
- Real `StateGraph` provider → typed tool → provider loop with a deterministic structured-call provider; not an LLM.
- Validated input schemas, 12 demo turns per disposable state, fixed graph recursion limit, 32 KiB request limit, and same-origin browser checks.
- Browser-memory state resets on refresh. It is untrusted, replayable practice state, **not** authentication, durable storage, a global quota, or secure proof of approval. Repeated decisions are idempotent only within the returned demo state.
- `/api/live` always returns 503. Adding a model key does not activate it.
- The **Channels** screen owns website delivery: it reads the current assistant identity, approved practice facts, most recently updated active workflow, and disposable conversation test to show a truthful `n of 4` readiness summary with links to each owning section. Draft workflows remain visibly incomplete; an immutable published version satisfies the practice workflow gate. It then explains the future publish → installation ID → snippet → verification sequence, with an interactive widget preview, a clearly non-installable example snippet, and future WhatsApp/Phone/theme explanations. The actual customer embed and all real integrations remain disconnected.
- Browser-local **My workflows** and **Template library** with guided salon, clinic, service-business, and Google Review Assistant starters. The selected assistant purpose produces a transparent best-fit recommendation and optional good-fit alternative; suggestions reorder and label the library but never add, activate, or publish a workflow. The review template drafts multilingual replies, sends low ratings or sensitive topics to an internal follow-up task, and requires approval before a public reply. Users personalize the job settings inside each node; guided template structure stays locked. Advanced workflows can add, connect, and remove reusable trigger, knowledge, AI, logic, approval, action, handoff, and reply nodes. Booking and public-review actions require an upstream approval. Saving updates the editable draft; publishing creates an immutable local version. Safe test plans expose the allowlisted job ID, effect, approval rule, and integration requirement while guaranteeing zero external writes. Google Business Profile is not connected.
- Browser-local **Your assistant** setup with three explicit responsibilities: **Identity** offers customer-support, receptionist, booking, sales, and custom-purpose starters, then defines the editable assistant name, role, greeting, voice, unknown-answer fallback, and recommended starting behaviors; **Business profile** defines the represented business and booking destination; **Knowledge** manages hours, services, FAQs, policies, and document previews. The saved identity is shared by Conversations and the website-channel preview, including its name, purpose, greeting, and safe fallback. Channels exposes Identity as a linked readiness input instead of duplicating its editor. Purpose starters do not activate integrations or permissions; those remain owned by Workflows. Sources carry language, origin, and draft/approved/outdated state; edits are reviewed before retrieval. The safe retrieval console searches approved sources only and supports English, Farsi, and Mandarin metadata without making an AI call. PDF and Word parsing, embeddings, and durable editor persistence remain disabled until the authenticated repository layer is connected.
- Parked Google OAuth/PKCE scaffolding with Supabase cookie refresh, an allowlisted callback return path, a protected `/workspace`, and sign-out. Authentication entry points are intentionally hidden from the current product navigation while the practice product flow is completed. The configured Supabase hostname is pinned to `yfmoggubjsffgameexfi`, and the owner workspace reads membership/tenant data through the signed-in user's RLS-scoped client.
- Applied Supabase migration `20261013051836_initial_tenant_foundation.sql`: 11 tenant tables, immutable workflow/knowledge versions, forced RLS on every table, membership policies for editable resources, and no browser grants or policies for checkpoints, approvals, or usage reservations.
- No live metrics, testimonials, or preloaded real customer information. Editable fields are sample-only and transmitted to this app’s server.
- Server-only OpenAI request scaffold and durable-storage interfaces are present, with no live transport. The tenant/auth schema is applied; browser-local editors are not yet connected to durable repositories.

The longer design documents describe future targets as well as demo requirements. Identity and tenant membership foundations now exist, but Google provider configuration and a real-account login still require environment/provider verification. Durable checkpoints, shared quotas, and live approval ledgers are **not implemented**. Vercel and Supabase can incur normal resource usage; zero model calls does not mean unlimited free hosting.

## Contribution boundary

Work only in the exact new repository the owner supplies. Do not modify any other repository or reuse its deployment connection. Confirm the target repository and branch before publishing. Do not create paid accounts, enable paid AI, connect real customer systems, accept new provider agreements, or deploy publicly merely because an implementation milestone is complete.

## License

The project’s own license has not been chosen by the owner; package metadata is UNLICENSED. Its LangGraph and other dependencies retain their respective open-source licenses.
