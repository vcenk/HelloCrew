"use client";

import { useState } from "react";
import { KeyRound, LogIn, Zap } from "lucide-react";

import { useDashboard } from "./provider";
import { ButtonLink, Panel, Pill } from "./ui";

function usd(micro: number) {
  return `$${(micro / 1e6).toFixed(2)}`;
}

export function LiveAiPanel() {
  const { account, liveStatus, toggleLive } = useDashboard();
  const [busy, setBusy] = useState(false);

  let body: React.ReactNode;
  if (
    account.status !== "signed_in" ||
    !liveStatus ||
    liveStatus.state === "signed_out"
  ) {
    body = (
      <div className="account-row">
        <span className="account-icon" aria-hidden="true">
          <Zap size={18} />
        </span>
        <div>
          <strong>Sign in to use live AI</strong>
          <p>
            Live replies use your workspace’s approved knowledge and a monthly
            spending limit, so they need an account.
          </p>
        </div>
        {account.status === "signed_out" && (
          <ButtonLink
            href="/login?next=/app/settings"
            size="sm"
            variant="primary"
            icon={LogIn}
          >
            Sign in
          </ButtonLink>
        )}
      </div>
    );
  } else if (liveStatus.state === "not_configured") {
    body = (
      <div className="account-row">
        <span className="account-icon" aria-hidden="true">
          <KeyRound size={18} />
        </span>
        <div>
          <strong>Server keys needed</strong>
          <p>
            Add{" "}
            {liveStatus.missing
              .map((m) =>
                m === "openai_key" ? "OPENAI_API_KEY" : "SUPABASE_SECRET_KEY",
              )
              .join(" and ")}{" "}
            to <code>.env.local</code>, then restart the dev server.
          </p>
        </div>
        <Pill tone="attention">Not configured</Pill>
      </div>
    );
  } else {
    const percent = Math.min(
      100,
      liveStatus.budgetMicroUsd > 0
        ? (liveStatus.spentMicroUsd / liveStatus.budgetMicroUsd) * 100
        : 100,
    );
    body = (
      <>
        <label className="switch switch-row">
          <input
            type="checkbox"
            checked={liveStatus.enabled}
            disabled={busy || !liveStatus.canManage}
            onChange={async (event) => {
              setBusy(true);
              await toggleLive(event.target.checked);
              setBusy(false);
            }}
          />
          <span aria-hidden="true" />
          <div>
            <strong>Use live AI for this workspace</strong>
            <small>
              {liveStatus.canManage
                ? `Replies come from OpenAI ${liveStatus.model}, grounded in your approved knowledge. Bookings still wait for you.`
                : "Only the workspace owner can change this."}
            </small>
          </div>
        </label>
        <div className="budget">
          <div className="budget-head">
            <span>This month</span>
            <strong>
              {usd(liveStatus.spentMicroUsd)} of{" "}
              {usd(liveStatus.budgetMicroUsd)}
            </strong>
          </div>
          <div
            className="budget-bar"
            role="progressbar"
            aria-label="Live AI budget used"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percent)}
            data-warn={percent >= 80}
          >
            <span style={{ width: `${percent}%` }} />
          </div>
          <p>
            When the limit is reached, replies switch back to practice mode
            until next month.
          </p>
        </div>
      </>
    );
  }

  return (
    <Panel
      title="Live AI"
      className="live-ai"
      actions={
        liveStatus?.state === "ready" ? (
          <Pill tone={liveStatus.enabled ? "success" : "neutral"}>
            {liveStatus.enabled ? "On" : "Off"}
          </Pill>
        ) : undefined
      }
    >
      {body}
    </Panel>
  );
}
