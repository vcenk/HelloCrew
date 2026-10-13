# Data model

Status: logical proposal, not an applied database schema. Supabase Postgres, Storage, Auth with Google sign-in, and pgvector are the selected direction; no project is connected yet.

## Ownership rules

Every tenant-owned record carries `tenant_id`. Unique constraints, foreign keys, lookups, authorization, and caches include tenant ownership wherever relevant. Use composite relationships to prevent a record in one tenant from pointing at a parent in another tenant. Do not rely on UUID secrecy. Database row-level enforcement is recommended where supported, in addition to application checks.

Server timestamps use UTC; display uses configured workspace or viewer timezone. IDs are opaque. Monetary amounts use integer minor units with an explicit currency; provider usage calculations preserve enough precision before conservative rounding. No credentials are stored in ordinary records.

## Core entities

| Entity            | Key fields                                                                           | Constraints and purpose                                                                   |
| ----------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Workspace         | id, name, status, timezone, created_at                                               | Root tenant; active, paused, archived                                                     |
| User              | id, auth_subject, created_at                                                         | Identity mapping; do not duplicate identity-provider secrets                              |
| Membership        | tenant_id, user_id, role, status                                                     | Unique tenant/user; owner, operator, viewer proposal                                      |
| Workflow          | tenant_id, id, name, status, current_draft_version, published_version                | Stable workflow identity; draft and published versions never overwrite one another        |
| WorkflowVersion   | tenant_id, workflow_id, version, definition, created_by                              | Immutable typed node/edge graph; validate before save and again before publish            |
| AssistantVersion  | tenant_id, assistant_id, version, mode, config, published_at                         | Immutable published versions; draft separate                                              |
| KnowledgeSource   | tenant_id, id, kind, name, status, metadata                                          | Manual, website, or file source; imported content is not usable until processing succeeds |
| KnowledgeRecord   | tenant_id, id, title, content, source_label, revision, status                        | Draft/published/archived; explicit provenance                                             |
| ToolConfiguration | tenant_id, tool_key, version, enabled, policy, integration_ref                       | Only registered tools; live status verified                                               |
| Conversation      | tenant_id, id, channel, visitor_ref, assistant_version, status                       | Tenant-bound session ownership; bounded retention                                         |
| Message           | tenant_id, conversation_id, id, role, content, created_at                            | Stable ordering; sanitize rendered content                                                |
| AgentRun          | tenant_id, conversation_id, id, state, revision, started_at, ended_at                | Atomic lease/version to avoid concurrent resume                                           |
| Approval          | tenant_id, id, run_id, tool_key, args_digest, proposal_revision, expires_at, status  | Immutable proposal snapshot; one terminal decision                                        |
| ToolExecution     | tenant_id, id, run_id, action_id, idempotency_key, args_digest, status, provider_ref | Unique tenant/tool/idempotency key; reconcile unknown outcomes                            |
| Handoff           | tenant_id, conversation_id, id, reason, summary, status, assignee_id                 | Requested/queued/claimed/resolved/cancelled                                               |
| UsageReservation  | tenant_id, id, run_id, call_id, amount, currency, status, expires_at                 | Unique call; reservation is not recorded as actual spend                                  |
| UsageEvent        | tenant_id, id, call_id, provider_request_id, tokens, amount, price_version           | Deduplicated measured/reconciled use                                                      |
| BudgetWindow      | tenant_id, scope, period_start, period_end, currency, limit, spent, reserved         | Atomic check and reserve; also global cap                                                 |
| AuditEvent        | tenant_id, id, actor_type, actor_id, action, target_id, outcome, timestamp           | Append-only application API; redacted payload                                             |
| ChannelEvent      | tenant_id, channel, external_event_id, received_at, status                           | Unique provider event prevents webhook replay                                             |

The checkpoint store must also enforce tenant ownership. A raw LangGraph thread ID must never be accepted as authority to load or resume state.

## State lifecycles

**Conversation:** open → awaiting_approval / awaiting_human / resolved / closed. Reopening is explicit and audited. A conversation in human control cannot simultaneously continue autonomous effectful actions.

**Run:** queued → running → awaiting_approval / awaiting_human / succeeded / failed / cancelled. A version number or lease guards each transition. Leases have fencing tokens so an old worker cannot keep writing after a new worker takes over.

**Approval:** pending → approved / rejected / expired / cancelled. Approved is not executed. Consumption is a separate atomic step bound to one tool action. Edited arguments create a new proposal and invalidate the earlier approval.

**Tool execution:** prepared → executing → succeeded / failed / unknown. Unknown means the external outcome cannot yet be established. It blocks blind retry and presents an honest pending-reconciliation state.

**Reservation:** reserved → settled / released / reconciliation_required. A timeout after a provider request may still incur cost. Do not release uncertain funds merely because a local timer expires.

## Atomic operations

1. **Reserve model budget:** Lock or conditionally update all relevant global and tenant budget windows; verify remaining amount and concurrency capacity; insert the unique call reservation; commit before sending a paid request.
2. **Consume approval:** Verify actor membership, status, expiry, proposal revision, argument digest, and permission version; mark it consumed and create or retrieve the unique execution record in one transaction.
3. **Record provider usage:** Deduplicate the provider response and settle the reservation exactly once; record known usage or preserve an uncertain reservation for reconciliation.
4. **Resume run:** Check tenant/conversation ownership and expected version; write new state with compare-and-swap semantics.
5. **Publish assistant:** Validate knowledge/tool references and readiness; save an immutable published configuration in one consistent operation.
6. **Publish workflow:** Lock the workflow row, validate the typed graph, integrations, approvals, and referenced knowledge versions; create an immutable version and change the published pointer atomically.

External APIs are outside database transactions. Use provider idempotency where available and persist execution intent before the call. If the provider cannot support safe retry or outcome lookup, classify an ambiguous result as unknown and request human reconciliation.

## Knowledge and source references

Store source record ID and revision alongside a generated answer's public evidence references. A later edit must not make an earlier answer appear to cite a version that did not exist. Retrieval filters tenant, assistant scope, publication status, and access level before ranking or model input.

## Retention and deletion

Retention values require an owner decision before collecting real data. Keep conversation content, operational audit data, and financial usage metadata separate so deletion can remove content without corrupting reconciliation. Implement a deletion job that covers messages, checkpoints, derived indexes, uploaded assets if introduced, and provider-side copies where supported. Record minimal deletion evidence without retaining deleted content. Backup expiry and any unavoidable retention must be disclosed accurately before launch.

## Index and migration expectations

Index tenant plus conversation/date; tenant plus approval/status/expiry; tenant plus handoff/status; tenant plus workflow/status; tenant plus knowledge/status; and budget scope/period. Add unique deduplication constraints, not only application checks. Every Supabase public-schema table must have RLS, explicit grants, and policies tied to verified membership; new tables are not assumed to be automatically exposed. Each migration needs a rollback or forward-recovery plan, staging verification, and a data ownership check. Never point a preview deployment at production data for convenience.
