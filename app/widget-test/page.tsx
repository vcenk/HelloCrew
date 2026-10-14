import Script from "next/script";
import { ArrowLeft, Leaf, MapPin, Sparkles } from "lucide-react";

import { DEMO_WIDGET_INSTALLATION_ID } from "@/lib/widget";
import styles from "./widget-test.module.css";

export default function WidgetTestPage() {
  return (
    <main className={styles.page}>
      <nav className={styles.nav}>
        <a href="/app?section=channels">
          <ArrowLeft size={16} /> Back to Channels
        </a>
        <strong>
          Northline <em>Studio</em>
        </strong>
        <span>Widget installation lab</span>
      </nav>

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.kicker}>
            <Sparkles size={15} /> FICTIONAL TEST WEBSITE
          </span>
          <h1>
            A quiet place
            <br />
            for <em>bright ideas.</em>
          </h1>
          <p>
            This separate page behaves like a customer website. The HelloCrew
            loader adds the chat iframe without sharing dashboard controls or
            private credentials.
          </p>
          <div className={styles.actions}>
            <a href="#services">Explore the sample studio</a>
            <span>Open the Practice button at bottom right →</span>
          </div>
        </div>
        <div className={styles.heroArt} aria-hidden="true">
          <span className={styles.sun} />
          <span className={styles.arch} />
          <span className={styles.leafOne}>
            <Leaf />
          </span>
          <span className={styles.leafTwo}>
            <Leaf />
          </span>
          <p>SPACE TO MAKE</p>
        </div>
      </section>

      <section className={styles.services} id="services">
        <article>
          <small>01</small>
          <h2>Studio visits</h2>
          <p>A fictional $40 visit used only to test grounded answers.</p>
        </article>
        <article>
          <small>02</small>
          <h2>Weekday hours</h2>
          <p>Monday–Friday, 9am–5pm from the approved sample profile.</p>
        </article>
        <article>
          <small>03</small>
          <h2>Easy arrival</h2>
          <p>Two fictional visitor parking spaces from the sample FAQ.</p>
        </article>
      </section>

      <footer className={styles.footer}>
        <span>
          <MapPin size={15} /> Fictional neighborhood, Canada
        </span>
        <span>No real booking or customer data</span>
      </footer>

      <Script
        id="hellocrew-practice-widget"
        src="/widget.js"
        strategy="afterInteractive"
        data-installation={DEMO_WIDGET_INSTALLATION_ID}
      />
    </main>
  );
}
