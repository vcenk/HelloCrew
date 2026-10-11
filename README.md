# HelloCrew

A welcoming workspace for business owners to set up, test, and supervise an AI assistant that can answer questions and use approved business tools.

**Status: implemented practice prototype, not live AI.** The public website is at `/`; the separate beginner-friendly studio is at `/app`. A real LangGraph graph runs deterministic tools against fictional sample data. Authentication is intentionally deferred; no real customers, private information, paid model calls, or external actions are supported.

## Start here

1. Read [Product requirements](docs/PRODUCT_REQUIREMENTS.md) for the first release and its boundaries.
2. Read [UX and onboarding](docs/UX_ONBOARDING.md) for the dashboard, navigation, and setup journey.
3. Follow [Implementation phases](docs/IMPLEMENTATION_PHASES.md) to build a safe demo before enabling live AI.
4. Use [Architecture](docs/ARCHITECTURE.md), [Agent and tools](docs/AGENT_TOOLS_APPROVALS.md), and [Data model](docs/DATA_MODEL.md) together when implementing the runtime.

## The first useful experience

A business owner edits fictional business information, and tries a free-text conversation in a clearly labeled demo. This synthetic demo does not require authentication; real private data and live operations require the later security foundation. They can see which information was used, review a simulated action, and practice handing a conversation to a human. The sample booking pauses for approve/decline and only changes disposable demo state; no real reservation is made.

The public landing page takes original visual inspiration from Gaia’s public website. The dashboard is independently designed and should feel approachable to someone who has never configured an AI product. Its primary navigation is Home, Conversations, Your assistant, Channels, and Settings. Knowledge lives under Your assistant. Technical details stay available without dominating the first experience.

## Technology decisions

- Next.js and TypeScript for the web application and server boundary.
- Open-source LangGraph JS for an actual stateful tool graph, including deterministic demo execution.
- Existing Vercel Pro hosting as the intended deployment target. Existing subscription coverage is not a guarantee of zero incremental cost.
- No paid LangSmith service, AI subscription, new infrastructure account, or billing system is required for the initial demo.
- Web first. WhatsApp and telephone adapters remain disabled future work.
- Live AI remains disabled until authentication, tenant isolation, durable persistence, an atomic usage ledger, provider setup, and explicit spending limits are implemented and tested.

## Documentation map

| Document | What it decides |
| --- | --- |
| [Product requirements](docs/PRODUCT_REQUIREMENTS.md) | Users, scope, outcomes, acceptance criteria |
| [Architecture](docs/ARCHITECTURE.md) | Boundaries, runtime, deployment design |
| [Data model](docs/DATA_MODEL.md) | Tenant ownership, records, constraints, lifecycles |
| [Security and privacy](docs/SECURITY_PRIVACY.md) | Threats, permissions, data handling, launch gates |
| [Agent tools and approvals](docs/AGENT_TOOLS_APPROVALS.md) | Graph, tool registry, confirmations, handoff |
| [UX and onboarding](docs/UX_ONBOARDING.md) | Navigation, page behavior, accessible states |
| [Implementation phases](docs/IMPLEMENTATION_PHASES.md) | Ordered work and exit criteria |
| [Tests and evaluations](docs/TESTS_EVALS.md) | Functional, safety, concurrency, and usability checks |
| [Deployment and configuration](docs/DEPLOYMENT_ENV.md) | Proposed environment contract and release runbook |
| [Cost controls](docs/COST_CONTROLS.md) | Limits, reservations, reconciliation, fail-closed rules |
| [Channel roadmap](docs/CHANNEL_ROADMAP.md) | Web first and later messaging/voice adapters |
| [Decisions and open questions](docs/DECISIONS.md) | Fixed constraints and unresolved choices |

## Run locally

Requires Node.js 22.12+ (verified with Node.js 24).

```sh
npm ci
npm run dev
```

Open http://localhost:3000 for the website and http://localhost:3000/app for the practice studio. No environment variables or model keys are needed.

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm start
```

## Verification

A clean `npm ci`, ESLint, TypeScript, unit/integration tests, and production build were run in the implementation workspace. See [verification results](docs/VERIFICATION.md). Browser visual/interaction QA is **not verified**: local Chromium could not launch because the execution environment blocks its socket, and browser interaction checks remain unverified. No screenshot was produced.

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
- Website practice available; WhatsApp, telephone, customer embed, and real integrations disconnected.
- No live metrics, testimonials, or preloaded real customer information. Editable fields are sample-only and transmitted to this app’s server.
- Server-only OpenAI request scaffold and durable-storage interfaces are present, with no live transport or database. An unapplied deny-first SQL schema draft is included for later review.

The longer design documents describe future targets as well as demo requirements. Planned identity, tenancy, durable checkpoints, shared quotas, and live approval ledgers are **not implemented**. Vercel hosting can incur normal resource usage; zero model calls does not mean unlimited free hosting.

## Contribution boundary

Work only in the exact new repository the owner supplies. Do not modify any other repository or reuse its deployment connection. Confirm the target repository and branch before publishing. Do not create paid accounts, enable paid AI, connect real customer systems, accept new provider agreements, or deploy publicly merely because an implementation milestone is complete.

## License

The project’s own license has not been chosen by the owner; package metadata is UNLICENSED. Its LangGraph and other dependencies retain their respective open-source licenses.
