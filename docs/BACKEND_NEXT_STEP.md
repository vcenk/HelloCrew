# Next step: grounded free-text practice

## Working now

- Edit a fictional business name, description, hours, up to eight service/price entries, up to eight FAQs, and a booking link under **Your assistant**.
- Apply the information to this browser tab's memory. It is not a database save; refreshing discards it. Unapplied edits are discarded when leaving the editor.
- Type a question (up to 500 characters). The server runs the real LangGraph provider/tool loop and reads the supplied sample information. No language model or external integration runs.
- FAQs match the exact question ignoring punctuation, case, and spacing. Hours, a named service's catalog price, booking links and human-handoff requests have conservative keyword routing. This is a retrieval prototype, not natural-language understanding. Listed prices are not calculated quotes. Unknown questions get an explicit unknown response.
- Applied settings affect free-text and the FAQ/quote/handoff quick prompts. **Try an approval** intentionally remains a fixed $40 studio-visit exercise, separately labeled. It does not use edited catalog prices or make bookings.
- Booking URLs are validated as http/https with no embedded credentials. They are displayed as plain text; the app does not fetch them, check availability, or book anything.
- Sample inputs are transmitted to this app's server for each practice question. Do not enter customer PII, secrets, or real private business data. No browser storage, analytics, provider transport, or durable persistence is added. Hosts may maintain normal access logs.

## Server foundation, not a live backend

`lib/server/provider.ts` is protected by `server-only`. It defines a provider contract, builds an OpenAI Responses API request, and exposes an adapter that **always throws**. It has no transport, key lookup, SDK, or network call. Request data stays in a user-role content item, never interpolated into the fixed instruction policy. `store: false` does not mean all provider retention is disabled. A prompt alone is not a production injection defense.

Official documentation consulted: [Migrate to Responses](https://developers.openai.com/api/docs/guides/migrate-to-responses). No model was chosen, tested, or priced and no provider account was connected.

`lib/server/contracts.ts` describes future tenant-owned business records, versioned checkpoints, atomic usage reservations, and approval consumption. These interfaces are **not implementations**. `docs/schema/001-foundation.draft.sql` is a reviewed-by-code-only Postgres design draft, never applied or tested against a database. Its tables start with forced RLS and no access policies. Correct trusted identity policies, concurrent budgets, retention jobs and restricted service roles still need implementation and tests.

`/api/live` remains unconditionally 503. A key, client-provided tenant ID, approval flag or enable environment variable cannot activate it. The readiness panel explains the missing pieces in plain language.

## Decisions needed before paid/live work

1. Select authentication and database providers when ready; authentication and hosting remain deferred.
2. Choose the OpenAI model, approved hard spending cap/currency and who can change it. Decide tenant and platform limits; reject requests when safe worst-case pricing is unavailable.
3. Approve data handling/retention and which business information may be sent to OpenAI. Store credentials only through the hosting provider's secret mechanism.
4. Implement and independently test verified sign-in, membership, durable tenant isolation, atomic budget reservation/reconciliation, signed/server-owned approvals, and provider timeouts/idempotency before adding a live transport.
5. Separately authorize a deployment and real channel connections. Nothing in this milestone deploys or connects them.

The existing browser-returned session remains untrusted, resettable practice state. Request size (32 KiB), turn count (12), field bounds and graph recursion limits are not durable quotas or protection against distributed hosting abuse.
