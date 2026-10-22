import Link from "next/link";
import type { ReactNode } from "react";

import { Brand } from "@/components/brand";

export const LEGAL_UPDATED = "October 18, 2026";
export const LEGAL_CONTACT = "cenk@agentland.app";

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
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
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/data-deletion">Data deletion</Link>
          </div>
        </nav>
      </header>
      <main className="marketing" id="main-content" tabIndex={-1}>
        <article className="legal">
          <h1>{title}</h1>
          <p className="legal-updated">Last updated: {LEGAL_UPDATED}</p>
          {children}
          <p className="legal-contact">
            Questions? Email <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a>.
          </p>
        </article>
      </main>
      <LegalFooter />
    </>
  );
}

export function LegalFooter() {
  return (
    <footer>
      <Link href="/">
        <Brand small />
      </Link>
      <p>HelloCrew is a product of AgentLand, Vancouver, BC, Canada.</p>
      <span className="legal-links">
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/data-deletion">Data deletion</Link>
      </span>
    </footer>
  );
}
