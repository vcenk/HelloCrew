# Channel integration roadmap

Status: the in-app web practice channel, real script loader, isolated iframe, fixed public demo installation, and separate installation test website are implemented. The demo can be embedded, but it exposes fictional practice facts only and is not a tenant-owned production installation. WhatsApp and Phone are future disabled adapters. No phone number, messaging account, customer domain, or external channel has been connected.

## Shared channel contract

Normalize inbound events into server-derived tenant/channel identity, verified sender/session reference, external event ID, conversation reference, timestamp, content, and permitted attachment metadata. Normalize outbound work into destination, public content, proposed effect, idempotency key, and delivery state.

The shared agent graph owns knowledge, tool policy, approvals, handoff, and budgets. An adapter owns channel authentication, transport, formatting, delivery receipts, and channel-specific restrictions. Never let an inbound payload choose an arbitrary tenant or bypass a tool permission.

Preserve received, accepted, sent, delivered, failed, and unknown states where supported. An API accepting a send does not prove the person received it. Webhook events require signature validation, replay protection, tenant mapping, deduplication, and safe handling of delayed or out-of-order events.

## Stage 1 Web demo

Provide a practice conversation in the HelloCrew application with synthetic data and no authentication requirement. Demonstrate grounded answers, booking-link behavior, simulated actions, and handoff. Maintain visible demo labels on desktop and mobile. The implemented `widget.js` loader and `demo-hellocrew` installation exercise the one-script iframe contract without issuing a tenant-owned installation ID. No external outbound messages, live model call, or live customer data is permitted.

## Stage 2 Live web pilot

Only after live gates pass, add a constrained visitor web experience or embedding mechanism. Decide authenticated owner administration, visitor session scope, allowed installation origins, privacy notice, retention, abuse protection, and human support. An origin allowlist supplements signed/validated sessions; it is not the sole authorization mechanism.

Verify tenant resolution, conversation access, cross-origin behavior, reconnect, refresh, rate limits, and mobile accessibility. Begin with approved knowledge and booking links. Real visitor data must not enter a demo deployment.

## Stage 3 Supported booking integration

Only build when a real business needs it and selects a supported provider. Verify available operations, permissions, timezones, availability freshness, duplicate prevention, provider booking IDs, cancellation/rescheduling, and ambiguous timeout recovery. Obtain approval for specific customer data transmission and booking details. Never infer a real reservation from a link click, simulated tool result, or optimistic UI state.

The booking link remains the fallback when no supported verified integration exists.

## Stage 4 WhatsApp

Before implementation, choose the official supported provider route and verify current account, business verification, messaging-window/template, opt-in, media, retention, and pricing requirements from that provider's official documentation. These rules can change; this document is a roadmap rather than a current WhatsApp compliance guide.

Required work includes secure webhook validation, deduplication, number-to-tenant mapping, inbound/outbound identity, consent records, approved templates when required, delivery status, human takeover, and per-message cost limits. Provisioning an account or number, accepting terms, and sending real messages require separate authorization. Keep adapter disabled until these are complete.

## Stage 5 Phone

Voice adds latency and interruption requirements along with carrier, speech-to-text, text-to-speech, recording, and potentially model charges. Select a provider only after verifying current capabilities, pricing, and required consent/disclosures. Do not claim recording or transcription consent rules are uniform across locations.

The design needs tenant-bound called-number routing, verified carrier callbacks, conversational turn management, interruption, silence/timeout handling, consent before any required recording, redacted transcripts, bounded call duration/cost, reliable transfer or callback behavior, and truthful fallback if no person is available. Verify an actual handoff rather than announcing a transfer optimistically.

No emergency-service capability, regulated advice, or unattended high-impact decisions are included. Phone remains visibly planned until end-to-end testing and explicit activation.

## Readiness checklist for every new channel

- Real business use case and an authorized provider/account.
- Verified current terms, pricing, data processing, and consent obligations.
- Tenant mapping, authentication/signature checks, replay and deduplication tests.
- Delivery semantics, failure/retry policy, and ambiguous-outcome handling.
- Shared policy, approval, handoff, and budget enforcement preserved.
- Relevant data retention/deletion and secret rotation supported.
- User-visible connected state backed by verified integration health.
- Approved controlled pilot and an immediate disable path.
