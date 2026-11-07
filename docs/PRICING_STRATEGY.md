# Pricing strategy

Status: decision-ready recommendation as of 2026-11-06. Supersedes the "Commercial model to test" section of
[RESEARCH_AND_UNIT_ECONOMICS.md](RESEARCH_AND_UNIT_ECONOMICS.md), which was an unvalidated hypothesis from 2026-10-12.
Competitor prices are public list prices checked on 2026-11-06, exclude tax, and change often. Nothing here
authorizes spend, establishes a payment provider account, or constitutes tax advice — the GST/HST section
summarizes published CRA rules and needs an accountant's confirmation.

## Decisions taken as input

The owner chose these on 2026-11-06. Everything below follows from them:

| Question | Decision |
| --- | --- |
| First market | **Canada**, priced in CAD |
| Legal entity | Canadian, so Stripe direct is available |
| Strategy | Premium from day one — fewer, higher-paying customers |
| Model | Move to **`gpt-6-luna`** from `gpt-4o-mini` |

Stripe does not open merchant accounts in Türkiye, so a Canadian entity is what makes the rest of this
document possible. Canada also turns out to be the cleanest fee position available: domestic cards, domestic
currency, no international surcharge and no conversion spread.

Reference rate used throughout: **USD 1 = CAD 1.40** (early November 2026; 90-day range 1.3767–1.4281).

## The finding that should shape the launch

**Only one tier can honestly be sold today.**

Website chat, Google Calendar booking, customer reminders, the owner digest, knowledge, workflows, the
Copilot and the inbox are built and working. WhatsApp, Instagram and Facebook are built but idle pending Meta
App Review. Google Business Profile reviews are blocked pending Google's approval — the connector already
says so in the UI. Voice is not built at all.

A three-tier page published this week would sell two tiers that cannot be delivered. Launch one tier, publish
the rest as roadmap with no price and no preorder, and add them when the approvals land. Raising a launch
price later is routine; refunding a customer who bought WhatsApp and waited three months for Meta is not.

## The Canadian anchoring problem

This is the biggest difference between a Canada-first and a US-first launch, and it cuts against premium
pricing.

In the US, the obvious comparison is Podium at a real **US$450–900/month (CA$630–1,260)**. Anything under
CA$300 looks like a bargain beside it.

In Canada, clinic and studio owners do not price against Podium. They price against **Jane App**, which is
the default practice-management system for physiotherapy, massage, chiropractic and mental health across
Canada, and which they already pay for:

| Jane App tier | Price |
| --- | ---: |
| Balance | CA$54/mo (1 practitioner, 20 appointments) |
| Practice | CA$79/mo + CA$17.50–40 per extra practitioner |
| Thrive | CA$99/mo + per-practitioner fees |

So a Canadian clinic owner quoted CA$199 will ask why an AI receptionist costs twice their entire clinic
system. **That objection will come up in every sales conversation and the answer has to be ready:** Jane is
the system of record — scheduling, charting, insurance billing. It does not answer the website chat at 9pm on
a Sunday, and it does not chase the enquiry that never became a booking. HelloCrew is priced against the
bookings it captures, not against the software it sits beside.

The ROI arithmetic is the argument, and in Canada it is favourable: a physiotherapy or massage appointment
runs CA$100–130. **Two captured appointments a month pay for the plan.** An agent answering 24/7 that cannot
manage two is not worth buying at any price.

## Measured unit costs

Measured from the production usage ledger (`hc_usage_reservations`), not estimated — these are real settled
charges on `gpt-4o-mini`:

| Metric | Value | Source |
| --- | ---: | --- |
| Settled model requests recorded | 52 | `hc_usage_reservations` |
| Average cost per agent reply | **US$0.000336** | `avg(settled_micro_usd)` = 336 micro-USD |
| Worst single reply observed | US$0.00067 | `max(settled_micro_usd)` |
| Messages per conversation | 5.7 | 91 messages over 16 conversations |
| Model requests per conversation | 3.25 | 52 requests over 16 conversations |
| **Measured cost per conversation** | **US$0.0011** | 17,465 micro-USD over 16 conversations |

Caveat: the sample is 52 requests of mostly owner testing, and real customer conversations run longer than
test ones.

### What `gpt-6-luna` changes

| Model | Input /Mtok | Output /Mtok | Cached input /Mtok |
| --- | ---: | ---: | ---: |
| `gpt-4o-mini` (current) | $0.15 | $0.60 | — |
| **`gpt-6-luna`** (chosen) | **$0.10** | **$0.50** | **$0.01** |

Working back from the measured figure at a 10:1 input-to-output ratio implies roughly 1,600 input and 160
output tokens per reply. At Luna's rates that is **about US$0.00024 per reply — a 29% reduction**, and
US$0.00078 per conversation. This is derived, not measured; it becomes measured once Luna is live and the
ledger refills.

**The cached-input rate is the more interesting number.** At $0.01 per Mtok, cached input is a tenth of
normal input. The system prompt, tenant knowledge and workflow policy are identical on every turn of a
conversation, so if roughly 80% of input tokens come from cache, cost per reply falls to about
**US$0.000125** — another 48% off. Worth building for deliberately rather than hoping for.

**Planning figure used below: CA$0.003 per conversation** — roughly four times the derived Luna cost, to
absorb longer threads, retries, tool calls and FX movement.

### Switching to Luna is not purely a config change

**Done on 2026-11-06.** The model, the two price variables and the Responses API switch are in; the live eval
suite passes 13/13 on Luna, including the booking scenario that exercises tool calling. What follows is the
record of why it needed a code change and not just an environment one.

Note that the eval harness calls `runAgentTurn` directly and does not go through the usage reservation
ledger, so **it produced no cost rows**. The 29% reduction below is still projected, not measured. It becomes
measured once real conversations run through the live endpoint and `hc_usage_reservations` refills.

Two code facts, both verified:

- **Good news: there is no model allowlist.** The model comes from `OPENAI_MODEL` / `OPENAI_MODEL_FAST` /
  `OPENAI_MODEL_STRONG` with `gpt-4o-mini` only as a fallback default (`lib/server/live-config.ts:41-48`). So
  the model name, and the two price variables used for budget reservation, are environment changes.
- **Snag: tool calling.** Luna supports function calling on Chat Completions **only when `reasoning_effort`
  is `none`**. `lib/models/openai.ts:21` sets `reasoning: { effort: "low" }`, and both the agent graph and the
  Copilot call `bindTools`. On Chat Completions that combination will not work. The fix is to set
  `useResponsesApi: true` on `ChatOpenAI` — the option exists in the installed `@langchain/openai@1.6.2` — or
  to drop reasoning effort to `none` and lose reasoning quality. The Responses API is also what
  `RESEARCH_AND_UNIT_ECONOMICS.md` already recommended.

Also: the price variables must move with the model. They currently default to 0.15/0.60, so leaving them set
while running Luna merely over-reserves, which is the safe direction. Moving to a *more* expensive model
without updating them would under-reserve, which is not.

**Re-run `npm run eval` after the switch.** Changing the model changes agent behaviour, and the eval suite
exists precisely to catch that.

### Fixed platform floor

Billed in USD, so shown both ways at 1.40:

| Item | Price | CAD | Note |
| --- | ---: | ---: | --- |
| Supabase Pro | $25/mo | CA$35 | One shared project with tenant RLS. Spend cap on by default. |
| Vercel Pro | $20/mo | CA$28 | Includes $20 usage credit. **Overage is uncapped** — see risks. |
| Resend | $0 → $20/mo | CA$0–28 | Free to 3,000 emails/mo; Pro $20 for 50,000. |
| **Total** | **$45–65/mo** | **CA$63–91** | Serves all tenants, not per customer. |

One customer at CA$199 covers the entire platform floor more than twice over.

## What competitors charge

### Canadian practice and booking software — the anchor

| Product | Price |
| --- | ---: |
| **Jane App** | CA$54 / 79 / 99 per month + per-practitioner fees |
| Square Appointments | $0 (1 staff), $49 Plus, $149 Premium per location |
| Fresha | $19.95/mo solo, $14.95 per staff on Team, + 20% new-client commission |
| Vagaro | $23.99/mo single calendar, +$10 per extra calendar |
| Booksy | $29.99/mo + $20 per team member, 30% on marketplace first visits |

These sell a calendar or a chart, not an employee. They set the anchor, and the "adds revenue on top" story
is what moves past it.

### AI messaging platforms — the real competition

| Product | Published price | In CAD at 1.40 |
| --- | ---: | ---: |
| Podium Core / Pro | US$399 / 599, AI add-on US$99–399 quote-only; real single-location cost **US$450–900** | **CA$630–1,260** |
| Birdeye | US$299 / 349 / 449 per **location**, annual | CA$419–629 per location |
| Thryv | US$99–499/mo depending on source, quote-based, 6-month minimum | CA$139–699 |

### Voice AI receptionists — adjacent, metered differently

| Product | Entry | Top published |
| --- | ---: | ---: |
| Dialzara | US$29/mo (60 min) | US$349/mo (1,000 min) |
| Rosie | US$49/mo (250 min) | US$299/mo (2,000 min) |
| Goodcall | US$79/mo (100 unique callers) | US$299/mo (2,000) |
| Slang.ai | US$399/mo per location | US$599 per location |

Billing units differ — minutes, unique callers, calls — so these are not comparable to each other, let alone
to chat. They matter as a willingness-to-pay signal: a small business will pay US$79–399/month for an agent
that answers for them.

### Generic chatbots — the commodity trap

Chatbase lists US$150/mo for 4,000 message credits; Botpress US$150/mo for 250 conversations and US$750 for
1,500. HelloCrew should not compete here. A chatbot answers; HelloCrew books, reminds and reports.

## Recommended pricing

### Launch now

**HelloCrew Receptionist — CA$199/month**, or CA$1,990/year (two months free).

Includes everything that works today: website chat agent, Google Calendar booking, customer reminders, the
owner's evening digest, knowledge base, workflow builder, owner Copilot, conversation inbox, staff and
service pricing, one location, **1,000 conversations/month**, overage CA$0.15 per conversation.

CA$199 is about US$142, so it lands beside the US$149 plan while reading as a round number in the market it
is sold in. It undercuts Podium's Canadian-dollar reality by roughly six times.

**If sales friction against the Jane anchor proves heavy, CA$149 is the fallback** — not CA$99. Dropping
under CA$100 concedes that HelloCrew is software beside Jane rather than an employee, and the margin analysis
shows there is no cost reason to go there.

### Publish as roadmap, no price, no preorder

- **Growth** — adds WhatsApp, Instagram and Facebook. Ships when Meta App Review approves.
- **Multi-location** — adds Google Business Profile review handling, multiple locations, priority support.
  Ships when Google approves Business Profile access.
- **Voice** — not built. Do not list it until a measured pilot exists.

When those land: **CA$199 / CA$449 / CA$899**, converted from the US$149/349/699 architecture in the older
research doc and rounded to Canadian price points. Still well under Birdeye per location.

### Why 1,000 conversations and not 300

The older doc proposed 300 conversations at US$149. At a CA$0.003 planning cost that allowance is over 200×
cost and buys nothing but an objection in every sales call and a support ticket whenever someone hits it.
1,000 conversations costs **CA$3.00/month**.

| Tier | Conversations | Planning AI cost | As % of price |
| --- | ---: | ---: | ---: |
| CA$199 | 1,000 | CA$3.00 | 1.5% |
| CA$449 | 4,000 | CA$12.00 | 2.7% |
| CA$899 | 15,000 | CA$45.00 | 5.0% |

Allowances should stay bounded, though — not because of tokens, but because conversation volume drives
*support* load, which the earlier research correctly identified as the larger real cost.

### Onboarding fee

The older doc proposed US$750–2,500. That is right for premium positioning but is a hard barrier beside a
CA$199 plan. Recommendation: **CA$650 one-time setup, waived on annual prepay.** It pays for the manual widget
install, knowledge loading and calendar connection, and waiving it on annual is the strongest single lever
for pushing customers onto annual billing.

### Trial

14 days, card required. Premium positioning argues against a free tier, and requiring a card filters
tyre-kickers. The existing `/api/demo` route already lets a prospect see the agent answer without an account,
which is the premium-compatible substitute for a free plan.

## Stripe fees, exactly

Stripe Canada's published rates (checked 2026-11-06). A subscription pays **both** the card fee and the
Billing fee:

| Component | Rate |
| --- | ---: |
| Domestic Canadian card | 2.9% + CA$0.30 |
| Stripe Billing (pay-as-you-go) | 0.7% of billing volume |
| **Effective on a Canadian subscription** | **3.6% + CA$0.30** |
| International card | +0.8% |
| Currency conversion | +2% |
| Stripe Tax, API integration | CA$0.50 per transaction |
| Dispute received | CA$15.00 |
| Instant payout | 1%, min CA$0.60 — standard payouts free |

### What that costs per plan

| Price | Monthly billing | Annual billing (per year) | Annual saving |
| --- | ---: | ---: | ---: |
| CA$199/mo | CA$7.46/mo → CA$89.52/yr | CA$1,990 → **CA$71.94** | CA$17.58 |
| CA$449/mo | CA$16.46/mo → CA$197.57/yr | CA$4,490 → CA$161.94 | CA$35.63 |
| CA$899/mo | CA$32.66/mo → CA$391.97/yr | CA$8,990 → CA$323.94 | CA$68.03 |

The CA$0.30 is charged twelve times on monthly billing and once on annual. Combined with the setup-fee
waiver, annual billing is worth pushing hard.

**Avoid sub-CA$20 price points.** At CA$9/month the fixed CA$0.30 alone is 3.3% on top of the 3.6%, so nearly
7% of revenue goes to Stripe. The premium strategy sidesteps this entirely.

### Canada is the best fee position of the options considered

Selling in the currency of the entity's own country avoids both surcharges:

| Scenario | Fee |
| --- | ---: |
| **Canadian entity → Canadian customers in CAD** | **3.6% + CA$0.30** |
| Canadian entity → US customers in USD | 4.4% + CA$0.30, plus 2% if converting to CAD |
| UK entity → US customers in USD | up to 5.85% + 20p |

When the US expansion comes, hold a USD balance and settle to a USD account to avoid the 2% conversion; the
0.8% international-card surcharge is unavoidable. That is a problem for later, and a small one.

## GST/HST

Summarized from published CRA rules — **confirm with an accountant before invoicing anyone.**

- Registration is required once worldwide taxable revenue exceeds **CA$30,000 over four consecutive calendar
  quarters**. The threshold is set in the Excise Tax Act and has not changed since 1991.
- SaaS and digital services are taxable supplies.
- **At CA$199/month, the threshold arrives at about 13 annual customers** (199 × 12 × 13 ≈ CA$31,044), sooner
  once setup fees count. So this is a near-term obligation, not a someday one.
- If a single sale pushes revenue over CA$30,000 inside one quarter, small-supplier status ends on that sale,
  and registration follows within 29 days.
- **Voluntary registration before the threshold is worth asking the accountant about.** It allows input tax
  credits on business expenses, and HelloCrew's customers are businesses that can claim the tax back anyway,
  so charging it is not the friction it would be when selling to consumers.
- The rate follows the customer's province — 13% HST in Ontario, 15% in the Atlantic provinces, 5% GST in
  Alberta, 5% GST plus provincial tax in BC. Quebec's QST mirrors the CA$30,000 threshold but registers and
  reports separately with Revenu Québec.
- **Stripe Tax handles the province logic** at CA$0.50 per transaction on an API integration, which is 0.25%
  at CA$199 — cheaper than its 0.5% no-code rate. Build it in from the start rather than retrofitting.

## Margin

At CA$199/month with 1,000 conversations, using the conservative CA$0.003 planning cost, Luna, and twenty
customers sharing the platform floor:

| Line | Monthly |
| --- | ---: |
| Revenue | CA$199.00 |
| Stripe (3.6% + CA$0.30) | −CA$7.46 |
| Stripe Tax | −CA$0.50 |
| AI at 1,000 conversations | −CA$3.00 |
| Email (reminders + digests) | −CA$0.40 |
| Platform floor share (1/20 of CA$91) | −CA$4.55 |
| **Gross profit** | **CA$183.09** |
| **Gross margin** | **92%** |

At CA$449 with 4,000 conversations the margin is about 93%; at CA$899 with 15,000, about 90%. The business is
not cost-constrained at any of these price points. **Support labour, not tokens, is the real variable cost**
— which is the argument for premium pricing and few customers rather than a land grab.

Break-even on the platform floor is **one customer**.

## Risks

- **Willingness to pay is still unresearched**, and in Canada this matters more than it would in the US
  because of the Jane anchor. The older doc's instruction stands and has not been done: interview five
  clinics and five salons before publishing a price. Everything here is competitor-anchored, which is
  evidence but not the same thing.
- **Revenue in CAD, costs in USD.** Supabase, Vercel, Resend and OpenAI all bill USD. A weaker Canadian
  dollar raises costs against fixed CAD prices. At 92% margin this is immaterial, but it is the reason not to
  price near cost.
- **Vercel Pro overage is uncapped.** Supabase enables a spend cap by default; Vercel does not. A traffic
  spike or an abused widget bills straight through. Set a spend alert and a budget before launch.
  `COST_CONTROLS.md` already makes the related point that application budgets cannot guarantee a provider
  invoice ceiling.
- **`COST_CONTROLS.md` requires an explicit model allowlist, and there isn't one.** The model is free-text
  from the environment. That is why the Luna switch is easy, and also why a typo or a careless change could
  point production at an expensive model while the reservation prices stay low.
- **The per-tenant cap is still at its default.** `hc_tenant_limits.monthly_budget_micro_usd` defaults to
  US$5.00 for every workspace. Map it to the tier, or a CA$899 customer hits a US$5 ceiling.
- **Premium pricing demands premium support.** CA$199/month from a Canadian small business buys an
  expectation of a human replying the same day. That is a commitment about the owner's time, not just a
  number on a page.
- **Churn is unmeasured and unmeasurable so far**, since there are no paying customers. A 92% gross margin
  says nothing about whether the product retains.

## What to build, in order

1. ~~Switch to Luna.~~ **Done 2026-11-06.** `OPENAI_MODEL=gpt-6-luna` with prices 0.10/0.50,
   `useResponsesApi: true` in `lib/models/openai.ts`, defaults and `.env.example` updated, evals 13/13.
   **Still to do: set the three variables in Vercel** — the local and example files are changed, but
   production keeps running `gpt-4o-mini` until the deployment environment is updated.
2. Stripe Billing with the launch product, monthly and annual prices in CAD, and the setup fee as a one-time
   item. Stripe Tax enabled for GST/HST from the first invoice.
3. A `hc_subscriptions` table — tenant, Stripe customer and subscription IDs, tier, status, period end.
   Webhook-driven, since a client cannot be trusted about its own plan.
4. Map tier → `hc_tenant_limits.monthly_budget_micro_usd` and the conversation allowance, so the cap that
   already exists starts reflecting what the customer paid for.
5. Conversation metering against the allowance, with overage charged as Stripe usage-based billing.
6. Dunning: failed payment, retry, grace period, then downgrade. Never delete a tenant's data for non-payment.
7. A billing panel in the dashboard — current plan, usage against allowance, invoices, cancel.

Steps 1–4 are the minimum to charge anyone. Steps 5–7 can follow the first paying customer.

Prompt caching is worth its own pass once Luna is live: at $0.01 per Mtok cached input against $0.10 normal,
structuring the system prompt and tenant knowledge as a stable cacheable prefix roughly halves cost per reply.
It is an optimization, not a blocker.

## Sources checked 2026-11-06

- [Stripe pricing](https://stripe.com/pricing), [Stripe Billing pricing](https://stripe.com/billing/pricing),
  [Stripe UK pricing](https://stripe.com/gb/pricing), [Managed Payments pricing](https://support.stripe.com/questions/managed-payments-pricing)
- [gpt-6-luna model card](https://developers.openai.com/api/docs/models/gpt-6-luna)
- [Supabase pricing](https://supabase.com/pricing), [Vercel pricing](https://vercel.com/pricing),
  [Resend pricing](https://resend.com/pricing)
- Jane App: [Jane App pricing Canada](https://www.ledgerlogic.ca/blog/jane-app-pricing-canada),
  [Jane App pricing guide](https://pabau.com/blog/jane-app-pricing/),
  [Balance/Practice/Thrive tiers](https://www.stackscored.com/pricing/mental-health-practice-management/jane-app/)
- Podium / Birdeye / Thryv: [Podium pricing 2026](https://astucia.io/blog/podium-pricing-2026-what-smbs-actually-pay),
  [Podium vs Birdeye](https://contractortoolstack.com/compare/podium-vs-birdeye/),
  [Podium vs Birdeye vs Pluspoint](https://www.pluspoint.io/blog/podium-vs-birdeye-vs-pluspoint-the-ultimate-platform-comparison)
- Voice receptionists: [AI receptionist pricing 2026](https://www.ultatel.com/blog/ai-receptionist-pricing/),
  [AI receptionist pricing models](https://www.getaira.io/blog/ai-receptionist-pricing-guide)
- Booking platforms: [salon booking software cost](https://heylilo.co/resources/pricing-switching/salon-software-cost-per-month),
  [Square vs Vagaro vs GlossGenius vs Fresha](https://www.thelocalgem.com/blog/square-vs-vagaro-vs-glossgenius-vs-fresha-2026-salon-pick)
- GST/HST: [$30,000 small supplier rule](https://canadianmoneyhelp.ca/articles/when-register-gst-hst-canada/),
  [small supplier threshold guide](https://clerra.ca/guides/gst-hst-small-supplier-threshold),
  [GST on digital products](https://payproglobal.com/answers/what-is-goods-and-services-tax-gst/)
- FX: [XE USD/CAD](https://www.xe.com/en-us/currencyconverter/convert/?Amount=1&From=USD&To=CAD)

Vendor pages are authoritative for Stripe, OpenAI, Supabase, Vercel and Resend. Podium, Birdeye and Thryv no
longer publish prices, so those figures are third-party reported and should be treated as a range, not a
quote. Jane App's entry tier is reported as both CA$54 and CA$59, suggesting a recent change.
