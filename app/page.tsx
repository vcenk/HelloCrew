import Link from "next/link";
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  MessageCircle,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Brand, Buddy } from "@/components/brand";
import { LegalFooter } from "@/components/legal-page";
export default function Home() {
  return (
    <main className="marketing">
      <nav className="site-nav" aria-label="Main navigation">
        <Link href="/" aria-label="HelloCrew home">
          <Brand />
        </Link>
        <div className="nav-links">
          <a className="nav-section-link" href="#how-it-works">
            How it works
          </a>
          <a className="nav-section-link" href="#possibilities">
            What it can do
          </a>
          <Link className="nav-sign-in" href="/login?next=/app">
            Sign in
          </Link>
          <Link className="button dark compact" href="/app">
            Meet your crew <ArrowUpRight size={17} />
          </Link>
        </div>
      </nav>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">
            <span className="dot" /> A little help for your big ideas
          </span>
          <h1>
            Your business.
            <br />
            With a little
            <br />
            <span className="serif">breathing room.</span>
          </h1>
          <p>
            Meet the helpful side of AI. A friendly assistant for everyday
            questions, thoughtful replies, and the next step. Always with you in
            charge.
          </p>
          <div className="hero-actions">
            <Link href="/app" className="button dark">
              Try the practice demo <ArrowUpRight size={20} />
            </Link>
            <a href="#how-it-works" className="text-link">
              Take a little look <ArrowRight size={17} />
            </a>
          </div>
          <div className="hero-note">
            <Check size={15} /> No card. No API key. Just a little curiosity.
          </div>
        </div>
        <div className="hero-art">
          <div className="orbit-ring" />
          <span className="art-star star-one">✳</span>
          <span className="art-star star-two">✦</span>
          <div className="floating-tag">
            <span className="dot" /> Room for the work you love
          </div>
          <Buddy />
          <Buddy variant="yellow" />
          <div className="mini-message">
            <span className="mini-icon">
              <MessageCircle size={21} />
            </span>
            <div>
              <strong>“What are your opening hours?”</strong>
              <span>A small question. A helpful next step.</span>
            </div>
            <span className="check-round">
              <Check size={15} />
            </span>
          </div>
          <span className="art-caption">
            Your new helping hand, taking shape.
          </span>
        </div>
      </section>
      <div className="promise-strip">
        <span>Built to feel simple</span>
        <span>
          <ShieldCheck size={18} /> You stay in control
        </span>
        <span>
          <Sparkles size={18} /> Open-source foundation
        </span>
        <span>
          <MessageCircle size={18} /> Plain words. Clear steps.
        </span>
      </div>
      <section className="section intro" id="how-it-works">
        <div>
          <span className="eyebrow">HELLO, A LITTLE MORE SPACE</span>
          <h2>
            Less busywork.
            <br />
            <span className="serif">More being you.</span>
          </h2>
        </div>
        <p>
          You don’t need to understand AI to get started. Explore what an
          assistant could do, see each step it takes, and approve the things
          that need your say.
        </p>
      </section>
      <section className="feature-grid" id="possibilities">
        <article className="feature-card cream">
          <span className="feature-number">01 / ANSWER</span>
          <div className="feature-visual speech-visual">
            <span>When are you open?</span>
            <span>
              Let me check that for you <Check size={15} />
            </span>
          </div>
          <h3>A welcoming first hello.</h3>
          <p>
            Help people find everyday answers from the information you choose to
            share.
          </p>
        </article>
        <article className="feature-card green-tint">
          <span className="feature-number">02 / HELP</span>
          <div className="feature-visual quote-visual">
            <span>Sample studio visit</span>
            <strong>
              $40 <small>USD</small>
            </strong>
            <em>Fictional example price</em>
          </div>
          <h3>From question to next step.</h3>
          <p>
            Explore how a tool can look up an answer or calculate a clear,
            consistent quote.
          </p>
        </article>
        <article className="feature-card pink-tint">
          <span className="feature-number">03 / CHECK IN</span>
          <div className="feature-visual approval-visual">
            <ShieldCheck size={29} />
            <strong>You have the final say.</strong>
            <span>Review → Approve → Continue</span>
          </div>
          <h3>A helping hand, not a free hand.</h3>
          <p>
            Pause for approval before important actions. Hand things to a person
            when needed.
          </p>
        </article>
      </section>
      <section className="preview-section">
        <div className="preview-copy">
          <span className="eyebrow">TRY IT, WITHOUT THE WHAT-IFS</span>
          <h2>
            A safe space
            <br />
            to <span className="serif">say hello.</span>
          </h2>
          <p>
            Try your receptionist with made-up examples first: see which answer
            it used, and approve bookings before anything happens. When you’re
            ready, switch on live AI and add it to your website.
          </p>
          <Link className="button dark" href="/app">
            Open your practice studio <ArrowUpRight size={18} />
          </Link>
        </div>
        <div className="product-preview">
          <div className="preview-top">
            <Brand small />
            <span className="badge">Practice mode</span>
          </div>
          <div className="preview-greeting">Let’s give it a little try.</div>
          <div className="preview-bubble">“Can I book a studio visit?”</div>
          <div className="preview-step">
            <span className="check-round">
              <Check size={15} />
            </span>{" "}
            Prepare a sample booking
          </div>
          <div className="preview-approval">
            <ShieldCheck size={20} />
            <div>
              <strong>A quick check before we continue.</strong>
              <p>This is a fictional request. Nothing gets booked.</p>
            </div>
          </div>
          <div className="preview-buttons">
            <span>Decline</span>
            <span>Approve sample</span>
          </div>
        </div>
      </section>
      <section className="closing">
        <span className="closing-star">✳</span>
        <h2>
          Good things start
          <br />
          with a <span className="serif">hello.</span>
        </h2>
        <Link href="/app" className="button dark">
          Meet HelloCrew <ArrowUpRight size={20} />
        </Link>
        <p>An AI front desk for small businesses. Designed around people.</p>
      </section>
      <LegalFooter />
    </main>
  );
}
