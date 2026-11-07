# Product strategy

Written 2026-11-07. Decisions to validate, not decisions already made. The pricing numbers come from
[PRICING_STRATEGY.md](PRICING_STRATEGY.md), which carries the competitor research and the margin working;
this document is the shorter statement of who the product is for and what gets built next.

## What HelloCrew is

An **approval-first AI front desk** for independent salons and wellness studios. It answers after-hours
questions from knowledge the owner approved, captures enquiries, prepares or books appointments in the
system the business already uses, shows the owner exactly which facts each answer came from, and asks
before anything risky, public, destructive or outward-facing.

It works **beside** the booking system, not instead of it. The business keeps its system of record. This is
the single most important positioning decision, and the Canadian market makes it unavoidable: clinic owners
already pay for Jane App, and a product asking them to migrate is a far harder sale than one that answers
the phone-equivalent at 9pm on a Sunday.

## Initial ICP

**One-location Canadian salons and wellness or esthetic studios with 2–10 staff.**

Why this shape:

- Enough bookings that missed enquiries cost real money, few enough that one owner still reads everything.
- A treatment is CA$100–130, so two captured appointments a month pays for the product.
- One location means no multi-location routing, no per-location pricing, and no head-office approvals.
- 2–10 staff means the existing calendar matters but is not a complex resourcing problem.

Explicitly **not** the first customer: multi-location chains, franchises, and anyone whose booking system
is bespoke.

## Integrations, in order

1. **Google Calendar** — built and working. Enough for a business whose calendar is the booking system.
2. **Square Appointments** — next. Common in Canadian salons, has a real API, and does not require the
   business to change anything.

Nothing else until those two carry a pilot. Each new integration is a permanent support surface.

## Pricing

- **One launch tier.** Not three. Two of the three tiers could not be delivered anyway while WhatsApp waits
  on Meta and reviews wait on Google, and a published tier nobody can buy is worse than no tier.
- **CA$199/month** to validate, with **CA$149 as a tested fallback** — tested, not an automatic retreat the
  first time someone hesitates.
- **Not below CA$100.** That concedes the product is software beside Jane App rather than an employee, and
  the margin analysis shows no cost reason to go there.
- **Ten interviews before any of this is final:** five salons and five clinics. This has been outstanding
  since the October research doc and is still outstanding. Everything above is anchored on competitor
  pricing, which is evidence but is not willingness to pay.

## What the pilot must measure

ROI has to be arguable from the owner's own numbers, not asserted:

| Metric | Why it matters |
| --- | --- |
| After-hours enquiries answered | The hours a human was never going to cover — the clearest value |
| Leads captured | Enquiries that left a way to follow up |
| Booking requests prepared | What the agent got as far as proposing |
| Confirmed bookings | What the owner approved and actually happened |
| Conversion rate | Enquiries → confirmed bookings |
| Human handoff rate | How often it correctly stepped aside; high is not automatically bad |
| Unanswered-question rate | Where the approved knowledge has holes |
| Estimated revenue influenced | Confirmed bookings × the business's own average ticket, stated as an estimate |

The last one is the number an owner renews on, and it must be computed from their service prices rather
than a flattering default.

## Language

**Canadian French is the next first-class language** — UI, knowledge and evaluations, not a translation
layer bolted on at the end. Quebec is a large share of the Canadian salon market and a product that answers
a French enquiry in English is worse than one that admits it cannot. The eval suite already covers Farsi
and Mandarin, so the pattern exists; French needs the same treatment plus translated UI.

## Segments deliberately deferred

**Clinics** are a later segment, despite Jane App making them look adjacent. Health-adjacent conversations
raise the bar on privacy, retention, deletion and practice-management integration well past what exists
today — Phase 5's audit and deletion work is the start of that, not the finish. Do not sell to a clinic
handling health information on the strength of a salon pilot.

**Voice** is a measured later pilot, not a current promise. It is not built, and the landing page no longer
implies otherwise. When it is attempted it needs its own cost measurement: the earlier research put a
realistic range at US$0.05–0.13 per minute before support, which is a different economic shape from chat
and may not fit a CA$199 plan at all.

## How this connects to the hardening work

[PILOT_HARDENING_PLAN.md](PILOT_HARDENING_PLAN.md) and the commits after it close the reliability gaps that
a supervised pilot would otherwise have hit: a webhook delivery that failed silently, two AI turns answering
one customer at once, a rate limit that did not hold across instances, no audit trail, and no way to leave.
None of that makes the product production-ready, and
[VERIFICATION.md](VERIFICATION.md#what-works-and-what-does-not) is the honest statement of what is and is
not true today.
