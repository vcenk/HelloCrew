# Cost controls

Status: required design. No budget, pricing, provider account, or live-spend authorization is established by this document.

## Cost posture

The first release uses deterministic demo responses and simulated tools, so no paid model calls are needed. Open-source LangGraph runs in the application; paid LangSmith is not required. Intended hosting uses the owner's existing Vercel Pro arrangement. Hosting usage, storage, bandwidth, model tokens, external integrations, and future messaging/voice can still create incremental charges. Do not describe the eventual live product as free.

Do not create paid services or silently enable trials. Choose a provider and durable store only when the owner is ready for live work and approves the relevant setup and spending. Current prices must be verified against the selected provider before activation; this document deliberately contains no invented rates.

## Live call admission

Every paid invocation needs a durable unique call ID and an atomic reservation covering the worst supported charge for that request. Reserve against both tenant and global budget windows, plus any per-session or per-run limits. Include all billable token classes and provider features that the selected model may use. Bound inputs and outputs conservatively; unknown pricing or an unbounded billable feature blocks the call.

The transaction is conceptually:

```text
lock or conditionally update relevant budget windows
reject if any spent + reserved + requested_reservation exceeds its limit
insert reservation for unique call_id
increment reserved totals
commit
only then send the provider request
```

Application-local counters, localStorage, cookies, temporary files, and in-memory maps are not durable budget controls on serverless hosting. Database availability failure must stop new paid calls. A cached budget check cannot authorize a call.

## Estimate, settle, reconcile

A conservative reservation is derived from maximum input/output usage and current approved pricing, using integer accounting after conservative rounding. Record pricing version, currency, model, and assumptions. Avoid cross-currency aggregation until a defined conversion policy exists.

After a known response, atomically settle measured usage once and release only the unused reservation. If actual usage exceeds the reservation because pricing or estimation was wrong, record the full cost, trip the appropriate stop, and investigate before further calls. Do not truncate actual spend to make a cap appear respected.

If submission may have reached the provider but the result is missing, keep the reservation pending reconciliation. A client disconnect or local timeout does not prove the call was free. Use provider request IDs/usage retrieval where available. Do not blindly repeat a paid call after an ambiguous result. Provider retries need their own bounded policy and accounting; assume a retry can cost money unless the provider explicitly guarantees otherwise.

## Layered limits

- Global period budget and immediate global kill switch.
- Tenant period budget and tenant pause control.
- Per-run model-call, token, tool-step, elapsed-time, and retry limits.
- Per-session and endpoint rate limits backed by a shared store for live traffic.
- Concurrent-call limits to bound in-flight exposure.
- Context trimming with preserved essential facts and no silent loss of approval state.
- Explicit model allowlist; no automatic upgrade to a more expensive model.
- Cache only authorized tenant-scoped safe results with versioned keys and retention.

Set thresholds and periods before live activation. No numeric spending allowance is assumed. Alerts help people react, but alerts alone are not hard stops. Hosting and external-provider account limits should also be configured where supported; application budgets cannot guarantee a total provider invoice ceiling under every provider billing behavior.

## What the owner should see

Show demo as “No paid AI calls.” Once live, show period, currency, actual spend, reserved/pending amount, remaining allowance, last reconciliation time, and a clear pause control. Explain that pending spend may settle later. Do not display an estimate as a final charge or claim a provider-side balance is known when only the application ledger is available.

## Cost review before adding a feature

For each integration, identify its charge unit, minimum commitments, retry behavior, storage/egress, expected volume assumption, and hard-stop mechanism. Compare a simple alternative such as a booking link before adding a paid booking/voice integration. A business feature is not ready merely because its model token cost is small.
