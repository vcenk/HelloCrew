# Platform research and unit economics

Status: research-backed recommendation as of 2026-10-12. Prices are public USD list prices checked on that date, exclude tax, and can change. Cost examples are planning assumptions, not invoices or guarantees.

## Executive decision

HelloCrew should own the tenant, workflow, conversation, approval, knowledge, and usage records. External services should be replaceable transport or inference providers, not the system of record.

The lean first production stack is:

- Next.js on the existing Vercel Pro project for the dashboard, web widget API, OAuth callbacks, and signed webhooks.
- Supabase Pro for Postgres, Google sign-in, private file storage, pgvector, tenant-level RLS, and a small durable queue.
- LangGraph JS inside server-only application code, with Postgres checkpoints for resumable runs. Checkpoints are execution state, not the customer-facing transcript.
- OpenAI through Vercel AI Gateway for a single billing/observability boundary and future fallback. Gateway currently charges provider list price with no token markup and also supports bring-your-own provider keys.
- An owned web-chat widget first; official Meta Cloud API for WhatsApp when onboarding is ready; LiveKit plus a SIP/telephony provider for voice only after text channels are stable.
- Direct provider adapters for systems clients already use, beginning with Phorest for a real salon pilot and Google Calendar for simple single-calendar businesses.

Do not start with a separate vector database, Redis, paid LangSmith, a self-hosted help desk, a general automation platform, or a home-grown multi-resource calendar. Postgres and one codebase are enough for the initial paid pilots.

## What the strongest repositories teach us

| Project | What to learn | Decision for HelloCrew |
| --- | --- | --- |
| [Chatwoot](https://github.com/chatwoot/chatwoot) | Mature omnichannel separation of account, inbox/channel, contact identity, conversation, message, assignment, delivery status, and webhook events. Its conversation and message models keep tenant/channel IDs on operational records. | Adopt the data shape, not the whole application: `Workspace -> ChannelConnection -> ContactIdentity -> Conversation -> Message`. Keep bot and human ownership separate. Chatwoot is MIT, but its enterprise areas still warrant file-level license review before any reuse. |
| [Typebot](https://github.com/baptisteArno/typebot.io) | Separates chat session state, results/answers, visited edges, variables, and logs. Its packages also separate engine, embeds, WhatsApp, API, and results. | Learn the separation but do not copy current competing code: its [FSL license](https://github.com/baptisteArno/typebot.io/blob/main/LICENSE) prohibits competing use until the future-license date for each release. Its security history also reinforces tenant-scoped session lookup and strict widget sanitization. |
| [LangGraph JS](https://github.com/langchain-ai/langgraphjs) | Typed state graphs, interrupts, resumable checkpoints, fault recovery, and long-term stores. [PostgresSaver](https://reference.langchain.com/javascript/langchain-langgraph-checkpoint-postgres) is the production persistence option; in-memory persistence is for development. | Keep LangGraph as orchestration, but keep permissions, spending limits, approvals, and tenant checks in deterministic application code. Use a UUID thread ID mapped to an authorized HelloCrew conversation. |
| [agents-from-scratch-ts](https://github.com/langchain-ai/agents-from-scratch-ts) | A compact pattern for triage, draft, interrupt, human accept/edit/reject, and memory. | Reuse the conceptual human-review flow for bookings, review replies, and risky messages. |
| [XYFlow](https://github.com/xyflow/xyflow) | Typed custom nodes, controlled graph state, save/restore, and browser testing. | Continue using it for the builder, while storing immutable published workflow versions rather than mutable canvas JSON only. |
| [LiveKit Agents](https://github.com/livekit/agents) | Apache-2.0 realtime voice framework with telephony, job distribution, turn detection, tests, and pluggable STT/LLM/TTS. | Preferred voice foundation because the agent can call the same HelloCrew/LangGraph tools. Run the realtime worker outside ordinary Vercel request handlers. |
| [Pipecat](https://github.com/pipecat-ai/pipecat) | BSD-2 pipeline architecture for audio frames, STT, LLM, TTS, and many transports. | Keep as the lower-level alternative if LiveKit pricing or provider flexibility becomes limiting. It requires more operational ownership. |
| [Trigger.dev](https://github.com/triggerdotdev/trigger.dev) | Durable background jobs, queues, retries, waits, and observability. | Do not add it initially. Supabase Queues/Cron can cover ingestion and short scheduled work. Reconsider when long-running jobs and operational tooling justify another platform. |

Archived demo repositories are useful references but poor foundations. Also pin and regularly update LangChain/LangGraph packages: the maintainers published several 2026 advisories involving deserialization and cross-namespace access. The repository's current `@langchain/langgraph` 1.4.21 is beyond the 1.4.12 serializer fix; when Postgres persistence is added, require `@langchain/langgraph-checkpoint-postgres` 1.0.6 or newer. Never deserialize user-supplied LangChain objects, never use a graph namespace as the only tenant boundary, and test cross-tenant denial independently of LangGraph.

## Recommended system shape

```text
Website widget ----\
WhatsApp webhook ---+--> Channel adapter --> durable inbox/dedup --> Conversation service
Google reviews -----/                                              |
                                                                  v
Dashboard <---- approvals + human inbox <---- LangGraph policy/workflow runner
                                                                  |
                                              tools: booking, review, CRM, email
                                                                  |
Phone/SIP --> LiveKit voice worker --> transcript turns -----------/

Supabase Postgres = source of truth
Supabase Storage  = private source documents/attachments
pgvector          = tenant-filtered knowledge chunks
```

Each inbound provider event is acknowledged quickly after signature validation and durable deduplication. Processing happens from the durable record or queue. The channel adapter translates formats; it cannot select an arbitrary workspace, grant a tool, or change approval policy.

## How information should be stored

### Tenant and channel records

- `workspaces`, `users`, and `memberships` define ownership and roles.
- `channel_connections` stores one website installation, WhatsApp number/WABA, Google location, or phone number per connection. Store encrypted credential references, health state, external account IDs, and scopes; never expose provider secrets to the browser.
- `contacts` represents a person inside one workspace. `contact_identities` maps that contact to `(workspace_id, channel_connection_id, external_user_id)`. Never resume a session by phone number alone.
- Every exposed tenant-owned table has Supabase RLS. Authorization uses server-verified membership or immutable app metadata, not editable user metadata. Service-role credentials remain server-only.

### Conversations and execution

- `channel_events` is the durable, deduplicated inbox/outbox ledger keyed by workspace, provider, and external event ID.
- `conversations` stores channel, contact, status, bot/human owner, language, last activity, and the published assistant/workflow version.
- `messages` stores normalized incoming, outgoing, activity, and internal-note entries with provider message ID, delivery state, reply relation, content type, timestamps, and redacted content.
- `message_delivery_events` preserves accepted, sent, delivered, read, failed, and unknown transitions. A successful send API call is not proof of delivery.
- `agent_runs`, LangGraph checkpoints, approvals, and tool executions are separate from messages. This prevents an operational retry or checkpoint from appearing as a customer message.
- Summarize older turns and send only the summary plus a bounded recent window to the model. Do not store or display private chain-of-thought. Store tool inputs/outputs only after schema-based redaction.

### Knowledge

- `knowledge_sources` describes manual content, URL imports, or uploaded files.
- Original files live in private Supabase Storage. Parsed records and chunks keep source ID, source revision, page/section, language, checksum, and publication status.
- Embeddings live beside chunks in Postgres `pgvector`, with workspace and publication filters applied before similarity ranking. This avoids an early Pinecone-style platform and keeps RLS-capable data in one place. Supabase documents RLS-aware RAG and Postgres-native vector search.
- Re-embedding is asynchronous and idempotent. Supabase's documented pattern combines pgvector, Queues/`pgmq`, Cron, and an Edge Function; a Vercel worker can also consume the queue.

### Proposed retention defaults

These require customer terms and legal/privacy review before production:

- Website and WhatsApp message content: 90 days by default, configurable from 30 to 365 days when a client has a documented need.
- Voice recording: off by default. If explicitly enabled with the required consent, use the shortest client-approved retention. Voice transcript: 30 days by default.
- LangGraph checkpoints: prune after the conversation retention period or earlier after terminal runs.
- Audit, delivery, tool, and billing metadata without message bodies: 12 months for support and reconciliation.
- Google Business Profile content: no more than 30 days. Google's API policy allows only limited temporary content storage and forbids using cached content as an independent dataset.
- Deletion must cover messages, summaries, checkpoints, embeddings, files, and provider-side copies where supported.

Clinics create a separate compliance tier. Do not claim HIPAA or similar regulated-health compliance merely because one vendor offers a BAA; the whole system, contracts, data flows, support process, logging, and customer configuration must qualify.

## How each channel should work

### Website chat

Build and own the widget. The host page receives a public installation ID, then the server issues a short-lived signed visitor session after checking the installation, allowed origin, rate limits, and bot-abuse controls. The browser never receives a workspace secret or model key.

The widget sends normalized messages to a Next.js Route Handler and receives streaming text through SSE or a fetch stream. The server persists the user message before running the graph, records the assistant response, and exposes a reconnectable conversation ID. A human takeover flag stops autonomous effectful nodes until the conversation is released.

This has the best margin: there is no per-message channel fee, and the same widget can be branded per workspace.

### WhatsApp

Use only the official WhatsApp Business Platform. The flow is:

1. Meta/Twilio calls the signed webhook.
2. Verify the signature, look up the receiving number/WABA in `channel_connections`, and insert a unique `channel_event`.
3. Upsert the tenant-scoped contact identity and open or resume a conversation.
4. Within the 24-hour customer-service window, run the same graph and send a free-form reply. Outside it, send only an approved message template for the permitted purpose.
5. Record provider IDs and later delivery/read/failure webhooks.
6. Provide a clear human or other support escalation path, as WhatsApp's policy requires for automation.

For the fastest first pilot, Twilio provides a sandbox and simpler onboarding, but currently adds $0.005 for every inbound and outbound WhatsApp message plus Meta template charges. For margin at scale, move to direct Meta Cloud API and Embedded Signup after HelloCrew qualifies and the onboarding flow is production-ready. Never use QR-code/WhatsApp Web automation repositories; the account and policy risk is unacceptable for a client SaaS.

### Phone/voice

Do not stream phone audio through a normal Vercel Function. Use:

```text
caller -> Twilio/Telnyx/SIP -> LiveKit room -> voice worker
       -> STT -> bounded LangGraph/tool request -> TTS -> caller
```

The voice worker owns interruption, silence, turn detection, audio, and latency. HelloCrew owns identity, knowledge, policy, approvals, booking tools, summaries, and the durable transcript. Require a verified transfer outcome; do not tell a caller they were transferred until the carrier confirms it.

LiveKit's current calculator shows an illustrative $0.0479/min stack, and its paid production plan starts at $50/month. Telnyx advertises a voice engine at $0.05/min plus LLM and telephony, with a roughly $0.06/min own-stack estimate. Vapi estimates $82-$129 per 1,000 minutes for a typical configuration, and Retell publishes a broad $0.07-$0.31/min range. These are not directly equivalent configurations, so run a 100-call pilot measuring language quality, latency, transfers, and exact provider receipts before selecting a permanent voice route.

English, Farsi, and Mandarin must each have recorded test suites. A provider saying “multilingual” is insufficient; verify code-switching, names, dates, service vocabulary, accents, and telephone-bandwidth audio.

### Google reviews

Use Google Business Profile OAuth, review notifications through Pub/Sub, and the review reply endpoint. Default workflow:

```text
new/updated review -> risk/rating check -> retrieve approved business facts
-> draft in the review language -> owner approves/edits -> post -> audit outcome
```

Google requires authorization to reply for a client and prohibits automated or triggered review replies without the user's prior specific and express consent. HelloCrew should therefore default to draft-and-approve, keep an immutable approval record, and provide easy disconnection. Low ratings, legal/medical claims, threats, or personal data always route to a human.

## Which integrations to build

### Build now or in the first paid pilot

1. Supabase Auth/Postgres/Storage/pgvector/Queues.
2. OpenAI Responses API through Vercel AI Gateway, using `gpt-6-luna` for routine classification, retrieval-grounded replies, and structured tool proposals. Escalate only demonstrably difficult turns to a stronger allowlisted model.
3. Owned website widget and dashboard human inbox.
4. One real booking adapter selected by the first client:
   - Phorest for a Phorest salon. Its official API supports clients, services, availability, and appointments, but currently has no webhooks; poll `updated_at` incrementally and reconcile conflicts.
   - Google Calendar for a simple single-calendar business. Standard API use is currently free, but it is not a salon scheduling engine.
5. Google Business Profile reviews if the first client values reputation management.

### Add after the web pilot is reliable

6. Official WhatsApp Cloud API with Embedded Signup; Twilio only as a speed-to-pilot bridge if its per-message markup is accepted.
7. Stripe for subscriptions, invoices, usage add-ons, and failed-payment state.
8. Transactional email through one provider such as Resend or Postmark for invitations, approvals, and alerts.
9. LiveKit plus a carrier/SIP provider for one controlled voice pilot.

### Avoid initially

- An internal multi-staff calendar. Availability, buffers, service duration, rooms, equipment, time zones, cancellations, deposits, and concurrency make this a product of its own. Use the system the business already trusts or a booking link.
- External vector databases, Redis, Kafka, or microservices before Postgres metrics prove they are needed.
- Copying Typebot, embedding Chatwoot, or adding n8n/Activepieces as the workflow runtime. They duplicate product boundaries and increase licensing, tenancy, and support risk.
- Storing the only conversation history in Twilio, Meta, LiveKit, OpenAI, or a help desk. Provider logs are diagnostic copies, not HelloCrew's source of truth.

## Minimum cost and pricing strategy

### Fixed platform floor

| Item | Current public price | Planning choice |
| --- | ---: | --- |
| Vercel Pro | $20/month with $20 included usage credit | Already in use; treat overage as variable. |
| Supabase Pro | from $25/month; one Micro project is covered by the included $10 compute credit | One shared production project with tenant RLS, not one paid project per client. |
| Vercel AI Gateway | provider token list price, no gateway markup | Centralize spend visibility and future model fallback. |
| LangGraph/LangSmith | LangGraph library is open source; paid LangSmith not required | Use application traces/audits initially. |

The base platform floor is therefore about $45/month before taxes and usage; because Vercel Pro already exists, the new fixed floor is roughly $25/month. Voice can add a $50/month LiveKit production plan when activated.

### Illustrative variable costs

- OpenAI `gpt-6-luna` is currently $0.10 per million input tokens and $0.50 per million output tokens. At 3,000 input plus 300 output tokens, one response is about $0.00045; 1,000 such responses are about $0.45. Retrieval, retries, larger contexts, stronger models, and tool calls add cost.
- `text-embedding-3-small` is currently $0.02 per million input tokens. Embedding 100,000 source tokens is roughly $0.002; storage and ingestion compute normally matter more at pilot scale.
- Twilio WhatsApp charges $0.005 per inbound or outbound message plus Meta template fees. One thousand customer messages plus one thousand replies therefore add about $10 in Twilio fees before Meta charges and model cost. Direct Meta removes that Twilio layer but increases onboarding work.
- A practical voice planning range is $0.05-$0.13/min before support and unusual add-ons, based on current LiveKit/Telnyx/Vapi examples. Track the actual per-call receipt; silence and transfers can still be billable.

### Commercial model to test

Do not sell tokens. Sell an operated business assistant with predictable included usage, then charge transparent overages:

| Offer hypothesis | Monthly price | Included scope |
| --- | ---: | --- |
| Web Starter | $149 | One workspace, website agent, 300 conversations, basic knowledge, owner inbox |
| Growth | $349 | 1,000 conversations, WhatsApp **or** Google Reviews, three active workflows, one booking integration |
| Multi-location | from $699 | 2,500 conversations, multiple locations/channels, advanced routing and priority support |
| Voice add-on | $199 + $0.35/min above 300 included minutes | One number/agent, summaries and transfer; carrier-specific charges disclosed |

Charge a one-time $750-$2,500 onboarding/integration fee while setup is manual. These are starting hypotheses, not researched willingness-to-pay. Interview five salons and five clinics before publishing prices.

Keep gross-margin rules simple:

- No unlimited plans.
- Reserve usage before paid calls and enforce global, workspace, run, and channel caps.
- Use Luna for routine work; escalate by policy and measurement, not automatically.
- Include a conservative usage allowance, then charge overages above direct cost.
- Pass through unusually expensive template, telephony, or custom integration charges with a visible service margin.
- Track support labor per workspace. For this product, human setup/support is likely a larger cost than tokens.

Competitor pricing supports room for this approach: Chatbase currently lists $150/month for 4,000 message credits, while Botpress lists $150/month for 250 conversations and $750/month for 1,500 conversations. HelloCrew should compete on vertical setup, accountable actions, multilingual service, and human oversight rather than being the cheapest generic chatbot.

## Recommended build order

1. Apply the Supabase tenant schema, Google sign-in, RLS denial tests, and durable workflow/template versions.
2. Add conversations/messages, the owned web widget, human takeover, and OpenAI behind the existing usage reservation design.
3. Add manual/file/website knowledge ingestion, private Storage, pgvector, source citations, and deletion jobs.
4. Add the first customer's real booking adapter, with provider idempotency and unknown-outcome reconciliation.
5. Add Google review draft/approval/post if demanded by the first client.
6. Add official WhatsApp and its template/consent/delivery ledger.
7. Add voice only after the same agent passes text-channel evaluations and a measured multilingual voice pilot.

## Primary sources checked

- [Supabase pricing](https://supabase.com/pricing), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [AI and vectors](https://supabase.com/docs/guides/ai), and [Queues](https://supabase.com/docs/guides/queues)
- [Vercel pricing](https://vercel.com/pricing) and [AI Gateway pricing](https://vercel.com/docs/ai-gateway/pricing)
- [OpenAI model catalog](https://developers.openai.com/api/docs/models), [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), and [embeddings](https://developers.openai.com/api/docs/models/text-embedding-3-small)
- [Twilio WhatsApp pricing](https://www.twilio.com/en-us/whatsapp/pricing), [WhatsApp policy](https://business.whatsapp.com/policy/preview?lang=fr_FR), and [Twilio Canada voice pricing](https://www.twilio.com/en-us/voice/pricing/ca)
- [LiveKit pricing](https://livekit.com/pricing), [Telnyx Voice AI pricing](https://telnyx.com/pricing/voice-ai-agents), [Vapi pricing](https://vapi.ai/pricing), and [Retell pricing](https://www.retellai.com/pricing)
- [Google Business Profile policies](https://developers.google.com/my-business/content/policies), [review reply API](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/updateReply), and [notifications](https://developers.google.com/my-business/reference/rest/v4/Notifications)
- [Phorest API getting started](https://developer.phorest.com/docs/getting-started) and [Google Calendar quotas/pricing](https://developers.google.com/workspace/calendar/api/guides/quota)
- [LangGraph persistence](https://github.com/langchain-ai/langgraphjs/blob/main/docs/docs/concepts/persistence.md) and [LangGraph JS security advisories](https://github.com/langchain-ai/langgraphjs/security/advisories)
- [Chatbase pricing](https://www.chatbase.co/pricing) and [Botpress pricing](https://botpress.com/en/pricing/)
