"use client";

import { useEffect, useState } from "react";
import { History, LogIn, RotateCw } from "lucide-react";

import {
  getRecentActivity,
  type ActivitySnapshot,
} from "@/app/app/activity-actions";
import type { ActivityEntry } from "@/lib/server/copilot/activity";

import { Button, ButtonLink, EmptyState, Panel, Pill } from "./ui";

/**
 * What happened in this workspace, and how it ended.
 *
 * The rows come from hc_audit_events, which holds counts and codes only — no
 * document text, no customer words, no model reasoning. So this panel can
 * show that a workflow was published and that three steps applied; it cannot
 * show what the workflow says, and it should not grow to.
 */

const OUTCOMES: Record<
  ActivityEntry["outcome"],
  { label: string; tone: "success" | "info" | "attention" | "neutral" }
> = {
  applied: { label: "Applied", tone: "success" },
  partial: { label: "Partly applied", tone: "attention" },
  draft: { label: "Saved as draft", tone: "info" },
  rejected: { label: "Rejected", tone: "neutral" },
  refused: { label: "Refused", tone: "attention" },
  failed: { label: "Failed", tone: "attention" },
};

function words(value: string) {
  const text = value.replace(/_/g, " ").trim();
  return text ? text[0]!.toUpperCase() + text.slice(1) : value;
}

function when(iso: string) {
  const at = new Date(iso);
  // Rendered after mount, so a locale string cannot mismatch the server.
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString();
}

/** Counts and a refusal code — never what was written. */
function details(entry: ActivityEntry) {
  const bits: string[] = [];
  if (entry.applied !== undefined) bits.push(`${entry.applied} applied`);
  if (entry.skipped !== undefined) bits.push(`${entry.skipped} skipped`);
  if (entry.reason) bits.push(entry.reason);
  return bits.join(" · ");
}

export function ActivityPanel() {
  const [snapshot, setSnapshot] = useState<ActivitySnapshot | null>(null);
  const [busy, setBusy] = useState(false);

  // The first load. State is set in the promise callback rather than in the
  // effect body: setting it synchronously there triggers cascading renders,
  // which is what `react-hooks/set-state-in-effect` is for. The cancelled
  // flag drops a late reply if the panel unmounts first.
  useEffect(() => {
    let cancelled = false;
    void getRecentActivity().then(
      (result) => {
        if (!cancelled) setSnapshot(result);
      },
      () => {
        if (!cancelled) setSnapshot({ state: "signed_out" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // Refreshing is an event, not synchronisation, so this may set state
  // straight away.
  async function refresh() {
    setBusy(true);
    try {
      setSnapshot(await getRecentActivity());
    } catch {
      setSnapshot({ state: "signed_out" });
    } finally {
      setBusy(false);
    }
  }

  let body: React.ReactNode;
  if (!snapshot) {
    body = (
      <p className="activity-note" role="status">
        Loading your workspace’s history…
      </p>
    );
  } else if (snapshot.state === "unavailable") {
    body = (
      <p className="activity-note">
        This workspace has no database configured, so nothing is being
        recorded.
      </p>
    );
  } else if (snapshot.state === "signed_out") {
    body = (
      <div className="account-row">
        <span className="account-icon" aria-hidden="true">
          <History size={18} />
        </span>
        <div>
          <strong>Sign in to see your workspace’s history</strong>
          <p>
            Only members of a workspace can read its record of what was
            changed.
          </p>
        </div>
        <ButtonLink
          href="/login?next=/app/settings"
          size="sm"
          variant="primary"
          icon={LogIn}
        >
          Sign in
        </ButtonLink>
      </div>
    );
  } else if (snapshot.entries.length === 0) {
    body = (
      <EmptyState icon={History} title="Nothing recorded yet">
        Actions your assistant takes — publishing a workflow, changing your
        hours, replying in public — appear here with who did them and how they
        ended.
      </EmptyState>
    );
  } else {
    body = (
      <ul className="activity-list">
        {snapshot.entries.map((entry, index) => {
          const outcome = OUTCOMES[entry.outcome] ?? {
            label: words(entry.outcome),
            tone: "neutral" as const,
          };
          const extra = details(entry);
          return (
            <li key={`${entry.at}-${entry.action}-${index}`}>
              <div className="activity-head">
                <strong>{words(entry.action)}</strong>
                <Pill tone={outcome.tone}>{outcome.label}</Pill>
              </div>
              <p className="activity-meta">
                <span>{words(entry.resource)}</span>
                <span aria-hidden="true">·</span>
                <span>
                  {entry.byYou
                    ? "You"
                    : entry.role
                      ? words(entry.role)
                      : "Automatic"}
                </span>
                <span aria-hidden="true">·</span>
                <time dateTime={entry.at}>{when(entry.at)}</time>
              </p>
              {extra && <p className="activity-detail">{extra}</p>}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <Panel
      title="Activity"
      className="activity"
      actions={
        <Button
          size="sm"
          variant="ghost"
          icon={RotateCw}
          onClick={() => void refresh()}
          disabled={busy}
        >
          {busy ? "Refreshing…" : "Refresh"}
        </Button>
      }
    >
      {body}
    </Panel>
  );
}
