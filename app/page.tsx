import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CloudOff,
  MessageCircle,
  MonitorSmartphone,
  Plug,
  ShieldCheck,
  Star,
  TestTube,
  Zap,
} from "lucide-react";

import { Brand, Buddy } from "@/components/brand";
import { CrewPreview } from "@/components/crew-preview";
import { LegalFooter } from "@/components/legal-page";

// The product model, in the order an owner actually goes through it.
const steps = [
  {
    icon: BookOpen,
    title: "Teach the crew what it may say",
    body: "Add your hours, services, prices and answers — or point it at a page or a price list. Nothing outside what you approved ever gets said.",
  },
  {
    icon: TestTube,
    title: "Test it on made-up customers",
    body: "Ask it anything in the practice studio and see which saved answer it used. No real customers, no cost.",
  },
  {
    icon: Plug,
    title: "Connect the channels you use",
    body: "Website chat, Messenger and Instagram, WhatsApp, Google reviews. One place to connect each account.",
  },
  {
    icon: ShieldCheck,
    title: "Approve anything that matters",
    body: "Bookings and public replies wait for your yes. You can step into any conversation and take over.",
  },
  {
    icon: Zap,
    title: "Switch to Live AI when it feels right",
    body: "Until you do, every reply comes from your saved answers. Live replies need an account and run inside a monthly budget you set.",
  },
];

const channels = [
  { icon: MessageCircle, name: "Website chat", detail: "A chat bubble on your own site." },
  { icon: MessageCircle, name: "Messenger & Instagram", detail: "Messages and comments on your posts." },
  { icon: MessageCircle, name: "WhatsApp", detail: "Messages to your business number." },
  { icon: Star, name: "Google reviews", detail: "Checked every 30 minutes, replies drafted for you." },
];

export default function Home() {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="marketing marketing-header">
        <nav className="site-nav" aria-label="Main">
          <Link href="/" aria-label="HelloCrew home">
            <Brand />
          </Link>
          <div className="nav-links">
            <a className="nav-section-link" href="#how-it-works">
              How it works
            </a>
            <a className="nav-section-link" href="#channels">
              Channels
            </a>
            <Link className="nav-sign-in" href="/login?next=/app">
              Sign in
            </Link>
            {/* Quieter than the hero's filled button, so the page keeps one
                dominant action. */}
            <Link className="button outline compact" href="/app">
              Open the practice studio
            </Link>
          </div>
        </nav>
      </header>

      {/* tabIndex lets the skip link actually move focus here. */}
      <main className="marketing" id="main-content" tabIndex={-1}>
        <section className="hero" aria-labelledby="hero-heading">
          <div className="hero-copy">
            <span className="eyebrow">
              <span className="dot" aria-hidden="true" /> Practice first. Go
              live when ready.
            </span>
            <h1 id="hero-heading">
              A crew your customers can talk to.
              <br />
              <span className="serif">And you can overrule.</span>
            </h1>
            <p className="hero-lede">
              HelloCrew answers your customers from the facts you approved —
              never from guesswork. Try the whole thing on made-up customers
              before a single real message reaches it.
            </p>
            <div className="hero-actions">
              <Link href="/app" className="button dark">
                Open the practice studio <ArrowUpRight size={20} />
              </Link>
              <a href="#how-it-works" className="text-link">
                See how it works <ArrowRight size={17} />
              </a>
            </div>
            <p className="hero-note">
              <CloudOff size={15} aria-hidden="true" /> Runs in your browser. No
              account, no card, nothing sent to the cloud until you sign in.
            </p>
          </div>

          <div className="hero-art">
            {/* A real slice of the practice studio rather than an abstract
                illustration. */}
            <div className="product-preview" aria-hidden="true">
              <div className="preview-top">
                <Brand small />
                <span className="badge">Practice mode</span>
              </div>
              <div className="preview-bubble">“Can I book a studio visit?”</div>
              <div className="preview-step">
                <span className="check-round">
                  <Check size={15} />
                </span>{" "}
                Used: Opening hours · Service catalog
              </div>
              <div className="preview-approval">
                <ShieldCheck size={20} />
                <div>
                  <strong>Waiting for your approval</strong>
                  <p>Nothing is booked until you say yes.</p>
                </div>
              </div>
              <div className="preview-buttons">
                <span>Decline</span>
                <span className="is-primary">Approve</span>
              </div>
            </div>
            <span className="art-caption">
              The practice studio, before anything is live.
            </span>
          </div>
        </section>

        <ul className="promise-strip" aria-label="What HelloCrew promises">
          <li>
            <ShieldCheck size={18} aria-hidden="true" /> Answers only from facts
            you approved
          </li>
          <li>
            <MonitorSmartphone size={18} aria-hidden="true" /> Practice runs in
            your browser
          </li>
          <li>
            <MessageCircle size={18} aria-hidden="true" /> Plain words, clear
            steps
          </li>
        </ul>

        <section className="section-block" aria-labelledby="crew-heading">
          <div className="section-intro">
            <span className="eyebrow">A CREW, NOT A CHATBOT</span>
            <h2 id="crew-heading">
              Different jobs,
              <br />
              <span className="serif">different crew members.</span>
            </h2>
            <p>
              Each one has its own job, its own skills and its own channels. You
              decide which of them you actually want.
            </p>
          </div>
          <CrewPreview />
        </section>

        <section className="section-block" id="how-it-works" aria-labelledby="steps-heading">
          <div className="section-intro">
            <span className="eyebrow">HOW IT WORKS</span>
            <h2 id="steps-heading">
              Five steps, and
              <br />
              <span className="serif">you hold the last one.</span>
            </h2>
            <p>
              You can stop after step two for as long as you like. Nothing goes
              near a real customer until you connect a channel yourself.
            </p>
          </div>
          <ol className="step-list">
            {steps.map((step, i) => (
              <li className="step-card" key={step.title}>
                <span className="step-index" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="step-icon" aria-hidden="true">
                  <step.icon size={20} />
                </span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="section-block" id="channels" aria-labelledby="channels-heading">
          <div className="section-intro">
            <span className="eyebrow">CHANNELS</span>
            <h2 id="channels-heading">
              Where your customers
              <br />
              <span className="serif">already are.</span>
            </h2>
            <p>
              Connect an account and the right crew member starts watching it.
              Phone calls and booking systems are planned, not available yet.
            </p>
          </div>
          <ul className="reach-list">
            {channels.map((channel) => (
              <li className="reach-card" key={channel.name}>
                <span className="reach-icon" aria-hidden="true">
                  <channel.icon size={19} />
                </span>
                <strong>{channel.name}</strong>
                <span>{channel.detail}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* The one thing people get wrong: practice and an account are
            different places. Spell it out side by side. */}
        <section className="section-block" aria-labelledby="choose-heading">
          <div className="section-intro">
            <span className="eyebrow">TWO WAYS IN</span>
            <h2 id="choose-heading">
              Practise now.
              <br />
              <span className="serif">Sign in when it earns it.</span>
            </h2>
          </div>
          <div className="choose-grid">
            <article className="choose-card">
              <span className="choose-tag">
                <CloudOff size={15} aria-hidden="true" /> No account
              </span>
              <h3>The practice studio</h3>
              <p>
                Open it and start typing. What you set up stays in this browser
                until you choose to sign in.
              </p>
              <ul className="choose-points">
                <li>
                  <Check size={15} aria-hidden="true" /> Free, no card, no API
                  key
                </li>
                <li>
                  <Check size={15} aria-hidden="true" /> Made-up customers only
                </li>
                <li>
                  <Check size={15} aria-hidden="true" /> Clears if you clear
                  your browser
                </li>
              </ul>
              <Link className="button dark" href="/app">
                Open the practice studio <ArrowUpRight size={18} />
              </Link>
            </article>

            <article className="choose-card is-account">
              <span className="choose-tag">
                <Check size={15} aria-hidden="true" /> Google sign-in
              </span>
              <h3>Your own workspace</h3>
              <p>
                An account gives the crew somewhere permanent to live, and is
                what real channels and Live AI need.
              </p>
              <ul className="choose-points">
                <li>
                  <Check size={15} aria-hidden="true" /> Saved in your private
                  cloud workspace
                </li>
                <li>
                  <Check size={15} aria-hidden="true" /> Pick it up on any
                  device
                </li>
                <li>
                  <Check size={15} aria-hidden="true" /> Connect real customer
                  channels
                </li>
                <li>
                  <Check size={15} aria-hidden="true" /> Turn on Live AI inside
                  a budget
                </li>
              </ul>
              <Link className="text-link" href="/login?next=/app">
                Sign in with Google <ArrowRight size={17} />
              </Link>
            </article>
          </div>
        </section>

        <section className="closing-cta" aria-labelledby="closing-heading">
          <span className="closing-art" aria-hidden="true">
            <Buddy />
          </span>
          <h2 id="closing-heading">
            Good things start
            <br />
            with a <span className="serif">hello.</span>
          </h2>
          <p>
            Nothing to install, nothing to cancel. Have a go with made-up
            customers and see what you think.
          </p>
          <Link href="/app" className="button dark">
            Open the practice studio <ArrowUpRight size={20} />
          </Link>
        </section>
      </main>

      <LegalFooter />
    </>
  );
}
