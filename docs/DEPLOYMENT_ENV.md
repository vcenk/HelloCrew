# Deployment and configuration

Status: future deployment/configuration contract. The implemented local demo needs no environment variables; `.env.example` documents that boundary. This implementation task does not deploy or create provider accounts, databases, or secrets. Existing hosting, if any, must be checked separately before publishing a new commit. The proposed flags below do not enable unimplemented live features.

## Environments

- **Local demo:** No authentication requirement, no secrets, synthetic fixtures, deterministic responses, no external effects.
- **Preview demo:** Same safety boundary; no production credentials or private data. Use hosting protection if appropriate, but do not treat it as application authentication.
- **Live staging:** Separate authorized credentials and data, authenticated administration, durable backend, tightly bounded test budget.
- **Live production:** Enabled only after the full readiness checklist and owner authorization.

Use the existing intended Vercel Pro account only after its actual project and repository association are verified and deployment is authorized. Never connect or modify a different repository. Existing hosting does not authorize new provider accounts, paid add-ons, domain purchases, or unbounded consumption.

## Proposed environment contract

Exact names may change during implementation, but safe behavior must remain.

| Variable | Demo value/default | Purpose |
| --- | --- | --- |
| `APP_MODE` | `demo` | Server-controlled mode; unknown value fails closed |
| `LIVE_AI_ENABLED` | `false` | Necessary but insufficient condition for paid calls |
| `LIVE_TOOLS_ENABLED` | `false` | Separate external-write kill switch |
| `CHANNEL_WEB_ENABLED` | `true` | Enables only the safe web implementation |
| `CHANNEL_WHATSAPP_ENABLED` | `false` | Future adapter; flag cannot instantiate missing code |
| `CHANNEL_PHONE_ENABLED` | `false` | Future adapter; no carrier account assumed |
| `LANGSMITH_TRACING` | `false` | Paid tracing is not part of this project |
| `DATABASE_URL` | Unset | Server-only authorized durable database connection |
| `AUTH_ISSUER` | Unset | Chosen identity provider; auth integration still open |
| `AUTH_SECRET` | Unset | If required by chosen auth stack; server-only |
| `AI_PROVIDER` | Unset | Explicit supported provider, never a guessed default |
| `AI_MODEL` | Unset | Explicit allowlisted model with known pricing |
| `AI_API_KEY` | Unset | Server-only provider secret; never committed |
| `GLOBAL_BUDGET_MINOR` | `0` | Total allowed budget in configured minor units |
| `TENANT_BUDGET_MINOR` | `0` | Default tenant budget; owner-approved values required |
| `BUDGET_CURRENCY` | Unset | Must match pricing/ledger currency before live use |
| `MAX_INPUT_TOKENS` | Bounded implementation value | Enforced server-side before provider request |
| `MAX_OUTPUT_TOKENS` | Bounded implementation value | Hard provider request cap |
| `MAX_GRAPH_STEPS` | Bounded implementation value | Prevent unbounded agent loops |
| `ALLOWED_APP_ORIGINS` | Explicit local/preview list | Additional request protection, not authentication |

Never use a `NEXT_PUBLIC_` prefix for secrets, budgets, permissions, or authority-bearing mode flags. A public display label may mirror server mode but cannot authorize behavior. An `.env.example` should contain only placeholders and safe defaults once code exists.

## Live readiness evaluation

The server evaluates all required conditions on startup and relevant requests:

1. Mode explicitly requests live operation and relevant feature flags are enabled.
2. Supported provider/model is configured with server-only credentials.
3. Authentication and verified membership enforcement are implemented.
4. Visitor sessions and public endpoint abuse controls are implemented.
5. Durable store and checkpoint ownership checks pass.
6. Atomic usage ledger, current price configuration, and nonzero approved budgets exist.
7. Approval, idempotency, and unknown-outcome reconciliation paths pass tests.
8. Privacy/retention setup, operational owner, and kill switches are ready.

If any condition is missing, return a structured unavailable result before provider/client construction or tool invocation. Do not make a “small test call” to discover readiness; that is already a potentially paid data transmission.

## Proposed release runbook

1. Verify the authorized repository, branch, commit, visibility, and target hosting project.
2. Install from the lockfile in a clean environment using the selected package manager.
3. Run full final-code type, lint, unit, integration, browser, and build checks.
4. Confirm no secrets, private data, or unrelated files are present in the diff or build output.
5. Review environment variables per deployment scope; demo remains the default.
6. Deploy only with authorization; confirm the resulting URL and exact deployed commit.
7. Smoke-test mode label, navigation, graph behavior, disabled integrations, and failure states.
8. Check logs for errors or accidental data leakage. For demo, verify zero provider/external-action calls.
9. Record verification and rollback target. Do not enable live mode as part of demo deployment.

## Rollback and operations

Keep a known-good deployment and migration recovery plan. Disable live calls/tools before investigating unsafe behavior. Roll back application code without blindly rolling back a database schema that newer data depends on; follow the specific migration plan. Check unresolved external effects and usage reservations before retries. Review hosting usage alongside AI usage because model caps do not cover bandwidth or compute.

Function runtime, duration, streaming, and payload constraints must be verified against the actual project settings at release time. Reference: [Vercel function limits](https://vercel.com/docs/functions/limitations). Do not promise an always-running agent process on a request-bounded host.
