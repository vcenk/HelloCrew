# UX and onboarding

Status: original proposed interface. Visual inspiration was reviewed on the public gaiababy.app landing page and its phone preview, not an authenticated dashboard.

## Public website and dashboard are separate

The Gaia reference applies to the public marketing website. Build an original landing page with a warm introduction, a truthful explanation of the assistant, a clearly labeled demo preview, and a “Try the demo” action. Use pale surfaces, rounded typography, restrained hand-drawn accents, and clear text-labeled navigation. Do not invent testimonials, customer logos, performance claims, prices, or live capabilities. An FAQ should distinguish what the demo does today from planned live features. The website must not imply that WhatsApp, Phone, or real booking are already available.

Design the working dashboard independently around the owner’s tasks. It can share HelloCrew’s visual tokens while prioritizing readable conversations, simple setup, and review controls. Authentication is not needed to explore the synthetic demo; show that real data and live capabilities remain unavailable.

## Experience direction

Create a calm, welcoming workspace with pale backgrounds, readable rounded typography, soft cards, obvious labels, and one clear next action. The reference informs warmth and approachability. Do not copy its assets, illustrations, exact layout, or wording. Keep hand-drawn decoration outside dense working areas.

Proposed original tokens:

| Token        | Value       | Use                                |
| ------------ | ----------- | ---------------------------------- |
| Canvas       | `#F7F6EF`   | Main background                    |
| Text         | `#232923`   | Primary readable text              |
| Primary      | `#315B48`   | Main actions and active navigation |
| Accent       | `#F1DB72`   | Small warm highlights              |
| Soft green   | `#DDEBD9`   | Gentle panels and selected states  |
| Border       | `#D5DACE`   | Card and input separation          |
| Card radius  | 20px        | Main cards                         |
| Input radius | 12px        | Fields                             |
| Navigation   | Pill-shaped | Text-labeled active state          |

Verify contrast for each actual text/background combination; a palette does not certify accessibility. Yellow is an accent, not a default text background for small white type. Use an available properly licensed font with a reliable fallback.

## Navigation

Desktop primary navigation: **Home**, **Conversations**, **Your assistant**, **Workflows**, **Channels**, **Settings**. Keep a visible “Try your assistant” action. The Workflows page begins with guided templates and exposes the advanced node canvas without implying that a local draft is live. Mobile navigation: **Home**, **Conversations**, **Assistant**, **More**; Workflows, Channels, and Settings live under More. Use labels alongside icons.

Your assistant contains three plain-language sections:

- **What it knows:** Business details and approved FAQs.
- **How it speaks:** Name, greeting, tone, and response examples.
- **What it can do:** Available tools, permission rules, booking link, and human handoff.

Technical model, tracing, persistence, and adapter settings belong under Advanced. Do not require a beginner to understand an orchestration framework to configure their business.

## First home screen

Lead with “Let's get your assistant ready” and one recommended next action. A compact checklist guides the owner through:

1. Add your business information.
2. Add a few common questions.
3. Try a practice conversation.
4. Connect your website when the live prerequisites are ready.

Do not mark a step complete because a user opened its page. Completion reflects validated saved data or a completed practice task. A live connection step stays visibly locked with the actual missing requirements.

Secondary areas show assistant status and a gentle explanation of what the product can help with. Avoid charts, jargon-heavy setup, fabricated customer counts, and a crowded grid of inactive integrations.

## Live home screen

Once a live pilot is genuinely enabled, replace first-run emphasis with an attention queue, recent conversations, and current assistant status. Show pending approvals, handoffs, and failures before optional metrics. Make “Pause live assistant” reachable and describe its effect. Metrics appear only when measured from actual records and clearly distinguish sample data.

## Setup flow

Each step has a short explanation, a preview, Save and continue, and a Back action that preserves saved work. Warn before discarding unsaved edits. Returning after an interruption restores the last durable checkpoint in a real workspace; demo persistence limits are explicit.

Required information is minimal: business display name, a short description, approved answers, and a human-contact path before live launch. Do not prefill invented prices, hours, services, customer endorsements, or legal claims. Optional booking URL input explains “Visitors will finish their booking on this page.”

Before publishing, show a summary of knowledge, permitted actions, human handoff, channel, mode, and readiness. Publishing is an explicit owner action and remains unavailable until all required gates pass.

## Practice panel

Open the assistant in a side panel on wide screens and a full page on small screens. Suggested prompts help users explore known answers, unknown answers, booking links, simulated review, and handoff. A persistent banner says “Demo mode · No real messages or bookings.”

Show concise activity such as “Checked your business information” and “Waiting for your review.” Do not display private chain-of-thought or imply a real integration call when using a fixture. Reset requires confirmation if it would discard the current practice conversation; it must never delete live data.

## Conversation detail

Use a message timeline, clear visitor/assistant/human attribution, status, evidence references, and a compact action panel. Approvals show exact consequential arguments with Approve and Reject. Handoff shows what was recorded and who, if anyone, has taken ownership. Unknown external outcomes receive a distinct state with reconciliation guidance.

A visitor sees the business assistant, an AI disclosure, relevant privacy information, and a clear route to a person. Owner-only settings, internal permissions, credentials, and other conversations are never sent to the visitor UI.

## Channels screen

Web is the first channel. Show Draft, Demo, Ready to connect, Live, Paused, or Needs attention based on real state. WhatsApp and Phone appear as “Planned” with a short explanation and no working Connect button. Do not invent account links or claim a number is connected.

## States and accessibility

Design empty, loading, saving, saved, invalid, permission denied, unavailable, offline, expired session, stale approval, budget reached, and unknown outcome states. Every state includes a useful next step when one exists.

Use semantic landmarks, keyboard navigation, visible focus, correctly labeled fields, screen-reader status announcements, and at least 44px touch targets. Keep dialogs focus-trapped with an accessible dismissal path. Respect reduced motion; optional transitions should be subtle, around 150–200ms. Test zoom, long business names, long answers, narrow layouts, and translated-text expansion even before localization is implemented.

## Copy examples

- Empty knowledge: “Add the answers customers ask for most.”
- Missing answer: “I don't have an approved answer for that yet.”
- Booking link: “You can choose a time on the booking page.”
- Simulated booking: “Demo request created. No real booking was made.”
- Live locked: “Live AI is off. Finish the security and spending setup before turning it on.”
- Human queue: “Your request is waiting for a person to review.” Use only after durable queue creation.

Reference reviewed: [Gaia public website](https://gaiababy.app/). These recommendations are an original product design, not a description of Gaia's signed-in product.
