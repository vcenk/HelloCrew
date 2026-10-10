# HelloCrew

A welcoming workspace for business owners to set up, test, and supervise an AI assistant that can answer questions and use approved business tools.

**Status: planning documents only. No application features have been implemented or verified.** Every feature, route, schema, command, and environment variable below is a proposed implementation contract unless explicitly marked otherwise. The authorized target is [vcenk/HelloCrew](https://github.com/vcenk/HelloCrew), which the owner allows to remain public for now. This package itself has not changed any GitHub repository.

## Start here

1. Read [Product requirements](docs/PRODUCT_REQUIREMENTS.md) for the first release and its boundaries.
2. Read [UX and onboarding](docs/UX_ONBOARDING.md) for the dashboard, navigation, and setup journey.
3. Follow [Implementation phases](docs/IMPLEMENTATION_PHASES.md) to build a safe demo before enabling live AI.
4. Use [Architecture](docs/ARCHITECTURE.md), [Agent and tools](docs/AGENT_TOOLS_APPROVALS.md), and [Data model](docs/DATA_MODEL.md) together when implementing the runtime.

## The first useful experience

A business owner explores fictional business information, gives the sample assistant a name, and tries a conversation in a clearly labeled demo. This synthetic demo does not require authentication; real private data and live operations require the later security foundation. They can see which information was used, review a simulated action, and practice handing a conversation to a human. A booking request initially leads to a configured booking page; the product does not claim to have made a real reservation.

The public landing page will take original visual inspiration from Gaia’s public website. The dashboard is independently designed and should feel approachable to someone who has never configured an AI product. Its primary navigation is Home, Conversations, Your assistant, Channels, and Settings. Knowledge lives under Your assistant. Technical details stay available without dominating the first experience.

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

## What is deliberately absent

There is no working app, package manifest, lockfile, deployed URL, database, real customer dataset, provider key, live booking integration, payment collection, or production security certification in this package. Do not run commands copied from this README as if setup already exists. A later implementation must add tested installation and development instructions that match its actual package manager and pinned dependency versions.

## Contribution boundary

Work only in the exact new repository the owner supplies. Do not modify any other repository or reuse its deployment connection. Confirm the target repository and branch before publishing. Do not create paid accounts, enable paid AI, connect real customer systems, accept new provider agreements, or deploy publicly merely because an implementation milestone is complete.
