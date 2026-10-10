# Product requirements

Status: planned. This document describes the intended product; it does not certify an implementation.

## Purpose

Give a small business owner a straightforward way to configure and supervise an assistant that answers from approved business knowledge, performs a small set of explicitly allowed actions, and asks for human help when needed. Begin with one useful web experience and a demonstrable agent workflow. Avoid a broad automation builder, marketplace, or billing platform in the first release.

## People and jobs

- **Business owner:** Set up the business, choose boundaries, review conversations and approvals, and pause the assistant.
- **Team member:** Review conversations or handle assigned handoffs within an explicitly granted role. Team invitations are a later capability unless needed for the pilot.
- **Visitor:** Ask a business question, understand whether they are interacting with AI, follow a booking link, or request a human.
- **Operator:** Maintain the application and investigate redacted operational failures without unrestricted access to every tenant's conversations.

The first setup can support one owner and one workspace while keeping every data access tenant-scoped. Multi-tenant readiness is a security requirement; subscription tiers and self-service SaaS billing are not initial requirements.

## Modes and honest labels

1. **Demo:** No authentication required. Deterministic fixture-based responses and simulated tools. A persistent banner says “Demo mode · No real messages or bookings.” Use fictional, visibly labeled sample information and no real visitor details. Refresh may reset a browser-local demo; tell the user before they depend on persistence.
2. **Configured draft:** Business information can be prepared in an authenticated durable workspace, but the assistant is not public and paid calls remain off.
3. **Live pilot:** A separately gated release with authenticated administration, durable state, abuse controls, bounded spend, and approved integrations. Live pilot is not enabled by adding a key alone.

Do not silently fall back from a failed live operation to simulated success. Display the failure and offer a safe next step. Demo routes must never import or invoke live provider or write-adapter implementations.

## First-release scope

### Public website

Build an original public landing page with the warmth and simplicity of the Gaia public-site reference. Explain the product, show a clearly identified demonstration, and offer “Try the demo.” Avoid invented proof points or claims that planned integrations are active. The dashboard design is independent of the reference.

### Owner dashboard

A warm greeting, clear setup checklist, assistant status, recent conversations, pending review count, and “Try your assistant” primary action. Display real measured counts only; empty states replace invented metrics. Demo statistics, if shown at all, must be marked as sample data next to the numbers.

### Assistant setup

Collect display name, description of the business, tone, supported topics, prohibited actions, human-contact instructions, and an optional validated booking URL. Preview the visitor experience before any publish step. Explain each setting with plain-language examples.

### Knowledge

Begin with manually entered FAQ and business-detail records. Each record has an owner, source label, revision, and publication status. Answers cite the matching record or admit that the information is missing. File ingestion and automatic website crawling are deferred; they require upload limits, extraction, provenance, permission, and untrusted-content controls.

### Conversations

Show a chronological conversation, public tool activity, outcome, and handoff state. Owners can filter by needs attention and open the exact record. Never expose private model reasoning. Show concise action summaries and evidence instead.

### Tools and review

Implement a real graph over a small tool registry. Initial tools retrieve approved information, return a configured booking link, simulate a booking request, and create a demo handoff. Simulated write actions pause for a visible review, demonstrating approve, reject, expire, and changed-arguments states. Live action adapters are disabled.

### Settings

Show workspace details, mode, permitted tools, channel availability, data controls, and usage. Advanced settings explain why live features are locked and list the missing gates. No decorative “connected” states for unconfigured services.

## Acceptance criteria

- An unfamiliar owner can reach a sample conversation from Home without reading technical documentation.
- Demo messages pass through the same graph policy stages intended for live mode, with deterministic planning and fixture adapters.
- A supported business question returns the approved answer and source; an unknown answer is not invented.
- A booking request offers the verified configured booking link or clearly identified simulation. It never claims a real booking.
- A write proposal cannot execute before a valid matching approval; rejection or expiry prevents execution.
- A request for a human records a handoff and tells the visitor what actually happened. No human-response time is promised unless configured and supported.
- A workspace cannot read, resume, approve, or mutate another workspace's data.
- Every disabled integration has clear explanatory text. Buttons do not imply working connectivity.
- Live provider invocation is impossible while any mandatory launch gate fails.
- Desktop, narrow-screen, keyboard-only, empty, loading, interrupted, and failure flows are usable.

## Explicit non-goals

Automated payments, real calendar booking without an integration, arbitrary code execution, unrestricted web browsing, general-purpose agents with all tools, WhatsApp or phone launch, multi-agent swarms, model fine-tuning, a vector database by default, marketplace integrations, paid observability, SaaS subscriptions, invented conversion claims, and unattended high-impact decisions.

## Outcome measurement

Measure setup completion, sample task completion, correct grounded answers, useful handoffs, blocked unsafe actions, and cost per successfully resolved live task when live use exists. Define success thresholds before a pilot using actual approved sample tasks. Do not turn simulated outcomes into business performance claims.
