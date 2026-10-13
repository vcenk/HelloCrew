# Security and privacy

Status: launch requirements with a partially implemented owner-auth boundary, not a claim of regulatory compliance. Supabase cookie sessions, verified claims, tenant membership RLS, project-ref pinning, and protected owner routing are implemented. Live visitor security, durable approval/usage transactions, retention, and production OAuth verification remain launch blockers.

## Trust boundaries

Browser input, visitor messages, knowledge documents, tool output, and model output are untrusted. Treat embedded instructions as content. Only server-side policy and verified user permissions can authorize an action. Never concatenate retrieved content into a higher-trust instruction channel or accept it as approval.

Separate owner administration from public visitor chat. A visitor may access only their scoped conversation and publicly approved business knowledge; they do not inherit owner permissions. A conversation reference, tenant slug, origin header, or installation identifier alone is not authentication.

## Minimum controls before live use

- Verified owner authentication and server-side membership checks on every entry point.
- Expiring visitor sessions bound to tenant, channel, and conversation; rotate and revoke safely.
- Tenant-scoped repositories, checkpoint access, caches, logs, approval lookups, and integration credentials.
- Durable transactions for approvals, idempotency, concurrency, and the usage ledger.
- Request/body limits, server-side rate and concurrency limits, abuse controls, and global kill switches.
- Explicit allowlist of tools, egress destinations, and provider models.
- Input schema validation, rendered output sanitization, and no arbitrary HTML execution.
- Secret isolation, redacted logging, and separate demo/preview/production credentials.
- Approved privacy notice, retention rules, provider data handling, and human-contact process.
- Passed security and concurrency tests in [Tests and evaluations](TESTS_EVALS.md).

Missing any required control keeps live mode unavailable. An environment flag or added provider key cannot override the readiness evaluation.

## Principal threats and mitigations

| Threat | Required mitigation |
| --- | --- |
| Cross-tenant object access | Membership and ownership checked server-side; composite relationships; negative tests |
| Prompt injection in knowledge | Treat source content as data; tool allowlist; deterministic policy; explicit approval |
| Changed action after approval | Canonical argument digest, proposal revision, expiry, authorized actor, one-time consumption |
| Replayed requests or webhooks | Durable unique idempotency/event keys, versioning, replay windows |
| Concurrent budget overspend | Atomic shared ledger; worst-case reservation; global and tenant limits |
| Duplicate external action | Durable intent, provider idempotency, outcome reconciliation |
| Leaked provider secrets | Server-only modules; secret manager/environment; no browser exposure or logs |
| SSRF through business URLs | Validate protocol/host; no server fetch initially; future egress controls and private-IP blocking |
| Malicious rendered content | Sanitization, safe links, content security policy, no unsafe HTML |
| Anonymous abuse | Scoped sessions, rate/concurrency/body limits, aggregate caps and a disabled-live fallback |
| Human takeover race | Durable handoff state invalidates pending effectful execution; serialized transitions |
| Privileged support access | Least privilege, explicit support workflow, audited access, no ambient all-tenant dashboard |

## Authentication and authorization

Owner, operator, and viewer roles are represented in the applied membership schema. Current RLS allows active members to read tenant resources, owner/operator roles to edit business/workflow/knowledge resources, and owners to delete or update workspace-level resources. Membership mutation, invitations, and sensitive re-authentication are not implemented. Checkpoints, approvals, and usage reservations deliberately have no authenticated browser grants or policies.

An approval actor must have permission for the underlying operation at execution time. Revoked membership or a disabled tool invalidates pending approval authority. Distinguish visitor consent from business authorization: neither alone grants the other party's privileges.

Cookies must use appropriate secure, HttpOnly, and same-site settings. Validate mutations against CSRF and origin threats. Handle logout, session expiration, navigation away, and revoked access explicitly. CORS is defense in depth, not tenant authorization.

## Data minimization

Collect the minimum information needed for the specific task. The initial demo accepts fictional sample data only and should warn users not to enter private customer information. Avoid asking for payment credentials, identity numbers, health data, or other sensitive details. Unsupported sensitive use cases should hand off through a business-approved process instead of retaining unnecessary detail.

Do not send an entire conversation or knowledge base to a model by default. Select the minimum relevant content. Before live use, disclose which provider receives what data, for which purpose, under which retention configuration. A provider choice is still open; no provider retention or training claim is made here.

## Logs and visible explanations

Log event type, tenant-safe identifiers, latency, status, model usage, and error category. Exclude raw credentials, access tokens, full message bodies, and private model reasoning. User-visible explanations show retrieved source titles and action outcomes. Application audit history records who approved what, when, and whether execution succeeded.

Access to conversation content should be purpose-limited and audited. Observability is local structured logging and a future owner-visible activity view; paid tracing services are not required.

## Incident and deletion runbook

1. Disable live invocation and affected adapters with server-controlled kill switches.
2. Preserve minimal diagnostic evidence; prevent logs from collecting more sensitive data.
3. Revoke compromised sessions or credentials through the authorized provider process.
4. Identify affected tenants, records, actions, and uncertain external outcomes.
5. Restore or reconcile state before allowing retries.
6. Notify appropriate owners through the approved incident process and applicable obligations.
7. Verify the fix, document impact, and explicitly authorize re-enablement.

Before live launch, choose an incident owner and implement a retention/deletion runbook that includes checkpoints, backups, exports, and third-party copies. This design is not legal advice or a certification.
