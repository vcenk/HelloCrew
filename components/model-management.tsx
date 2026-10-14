import { Bot, LockKeyhole, Route, ServerCog } from "lucide-react";

import { activeModelPolicy, modelProviders } from "@/lib/model-policy";
import styles from "./model-management.module.css";

export function ModelManagement() {
  return (
    <section className={styles.section} aria-labelledby="model-routing-title">
      <div className={styles.heading}>
        <div>
          <span>AI MODEL ROUTING</span>
          <h2 id="model-routing-title">One assistant. Flexible engines.</h2>
          <p>
            Model providers belong behind HelloCrew’s server boundary—not in the
            website snippet, workflow, or customer browser.
          </p>
        </div>
        <strong>Practice engine active</strong>
      </div>

      <div className={styles.providerGrid}>
        {modelProviders.map((provider) => (
          <article
            className={provider.status === "active" ? styles.active : ""}
            key={provider.id}
          >
            <span className={styles.providerIcon}>
              {provider.id === "practice" ? (
                <Bot size={19} />
              ) : (
                <ServerCog size={19} />
              )}
            </span>
            <div>
              <small>{provider.product}</small>
              <h3>{provider.label}</h3>
              <p>{provider.description}</p>
            </div>
            <span className={styles.status}>
              {provider.status === "active" ? "Active" : "Not connected"}
            </span>
          </article>
        ))}
      </div>

      <div className={styles.policy}>
        <div>
          <Route size={18} />
          <span>
            <strong>Stable routing contract</strong>
            The widget always calls HelloCrew, so changing a model later does
            not require reinstalling the website script.
          </span>
        </div>
        <div>
          <LockKeyhole size={18} />
          <span>
            <strong>Server-only credentials</strong>
            Provider keys, model IDs, budgets, and fallback order will stay out
            of the browser.
          </span>
        </div>
        <small>
          Current primary: {activeModelPolicy.primary} · No external fallback
          configured
        </small>
      </div>
    </section>
  );
}
