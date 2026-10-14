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

The studio follows one visible operating sequence instead of a flat list:

1. **Overview — Home:** orientation, current path, and the next section. No editing or testing happens here.
2. **Build — Your assistant:** assistant identity, business profile, approved knowledge, source status, and source-level retrieval checks.
3. **Build — Workflows:** behavior rules, tool jobs, approvals, handoffs, and internal path tests.
4. **Test — Conversations:** customer-facing prompts, final replies, activity traces, and approval moments.
5. **Launch — Channels:** website preview, publish readiness, installation instructions, and channel status.
6. **Manage — Settings:** practice visibility, privacy context, and disposable session controls.

Desktop navigation groups those sections as Overview, Build, Test & launch, and Manage. Mobile keeps the same order in a horizontally scrollable labeled navigation. The selected section is reflected in the `section` query parameter so refresh, browser back, and shared links retain context.

Every working section begins with a compact definition of its job, what belongs there, what stays elsewhere, and the next handoff. Cross-links navigate to the owning section; they do not reproduce another section’s controls.

The Workflows page separates **My workflows** from the **Template library**. Guided templates lock the safe graph and let users edit only registered job settings; the advanced canvas remains available without implying that a local draft is live.

The Template library may recommend a workflow from the saved assistant purpose. It shows one clearly explained best fit and, where useful, one good-fit alternative; recommended templates are ordered first. Recommendation is guidance only: nothing is copied, saved, activated, or published until the owner explicitly chooses a template and completes the normal review flow.

The Google Review Assistant starter exposes business locations, reply voice, languages, risk rules, and follow-up timing. It labels Google Business Profile as disconnected until OAuth and API access are complete. All public replies require review of the exact proposed text; low ratings and sensitive topics create internal dashboard tasks rather than implying a private Google conversation.

Your assistant is organized as three visible setup steps with separate ownership:

- **Identity — who speaks:** begin with a customer-support, receptionist, booking, sales, or custom-purpose starter. Each starter supplies editable placeholder copy and three recommended starting behaviors, followed by the assistant name, primary role, visitor greeting, voice, and the safe response used when no approved answer exists. A starter never silently activates an integration or external action.
- **Business profile — who it represents:** public business name, factual description, and optional booking destination. The summary points to operational facts without duplicating their editor.
- **Knowledge — what it may use:** hours, services, FAQs, policies, and document previews. It separates draft, approved, and outdated sources; shows EN/FA/ZH coverage; and includes an approved-only retrieval test before any AI is enabled.

Behavior, tools, permissions, approvals, and handoff rules belong to **Workflows**. End-to-end customer replies belong to **Conversations**. This prevents identity, facts, and actions from being edited in overlapping places.

The saved Identity is reused consistently: Conversations shows the configured assistant name and greeting and uses its safe fallback only when the grounded lookup reports no matching information; the website preview shows the same name, purpose, and greeting; Channels links back to Identity as a readiness input. These surfaces preview and test the configuration but do not edit it.

Technical model, tracing, persistence, and adapter settings belong under Advanced. Do not require a beginner to understand an orchestration framework to configure their business.

## First home screen

Home is the product map, not a second workspace. It shows one recommended action and a four-stage sequence:

1. **Teach:** define identity, business context, and trusted answers in Your assistant.
2. **Design:** define behavior rules in Workflows.
3. **Test:** review customer-facing results in Conversations.
4. **Launch:** publish and install through Channels.

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

Web is the first channel. Channels owns delivery only: the widget preview, readiness summary, publishing, installation, and live verification. Knowledge, workflow, and conversation readiness appear as compact prerequisites with links back to their owning sections; their editors are not repeated here.

The implemented practice screen shows the future channel-specific sequence—publish a safe version, create an installation ID, add the snippet, and verify the widget. It includes an interactive preview and an example embed snippet labeled “Not installable yet.” All four installation steps stay locked until the secure visitor-session and installation backend exists. WhatsApp and Phone appear as later work with short explanations and no working Connect button. Do not invent account links or claim a number is connected.

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
