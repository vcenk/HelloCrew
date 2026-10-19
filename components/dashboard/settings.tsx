"use client";

import { useRef } from "react";
import {
  Cloud,
  CloudOff,
  LogIn,
  LogOut,
  Monitor,
  Moon,
  RotateCcw,
  Sun,
  Trash2,
} from "lucide-react";

import { signOutOfDashboard } from "@/app/app/actions";

import { AlertsPanel } from "./alerts-panel";
import { LiveAiPanel } from "./live-ai-panel";
import { useDashboard, type Theme } from "./provider";
import { Button, ButtonLink, PageHeader, Panel, Pill } from "./ui";

const themes: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "Match system", icon: Monitor },
];

export function SettingsView() {
  const {
    theme,
    account,
    setTheme,
    showActivity,
    setShowActivity,
    resetConversation,
    conversation,
    toast,
  } = useDashboard();
  const confirm = useRef<HTMLDialogElement>(null);

  return (
    <div className="settings">
      <PageHeader
        title="Settings"
        description="Your account, live AI, appearance and the data stored in this browser."
      />
      <Panel title="Account" className="settings-account">
        {account.status === "signed_in" ? (
          <div className="account-row">
            <span className="account-icon" aria-hidden="true">
              <Cloud size={18} />
            </span>
            <div>
              <strong>{account.workspaceName}</strong>
              <p>
                Signed in as {account.email ?? "your Google account"}. Your
                assistant, knowledge and workflows save to this workspace
                automatically.
              </p>
            </div>
            <Pill tone="success">{account.role}</Pill>
            <form action={signOutOfDashboard}>
              <Button type="submit" icon={LogOut} size="sm">
                Sign out
              </Button>
            </form>
          </div>
        ) : (
          <div className="account-row">
            <span className="account-icon" aria-hidden="true">
              <CloudOff size={18} />
            </span>
            <div>
              <strong>Saved in this browser only</strong>
              <p>
                {account.status === "unavailable"
                  ? "Accounts aren’t configured on this server yet, so your setup stays in this browser."
                  : "Sign in with Google to keep your setup in your own workspace and use it on any device."}
              </p>
            </div>
            {account.status === "signed_out" && (
              <ButtonLink
                href="/login?next=/app/settings"
                variant="primary"
                size="sm"
                icon={LogIn}
              >
                Sign in
              </ButtonLink>
            )}
          </div>
        )}
      </Panel>

      <AlertsPanel />

      <div className="settings-grid-v2">
        <Panel title="Appearance">
          <div className="segmented" role="radiogroup" aria-label="Theme">
            {themes.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={theme === option.value}
                onClick={() => setTheme(option.value)}
              >
                <option.icon size={16} aria-hidden="true" />
                {option.label}
              </button>
            ))}
          </div>
          <label className="switch switch-row">
            <input
              type="checkbox"
              checked={showActivity}
              onChange={(e) => setShowActivity(e.target.checked)}
            />
            <span aria-hidden="true" />
            <div>
              <strong>Show reply steps in the inbox</strong>
              <small>Lists the tools used under each assistant message.</small>
            </div>
          </label>
        </Panel>

        <Panel title="Practice data">
          <p className="settings-copy">
            {account.status === "signed_in"
              ? "Resetting clears this browser only; your workspace copy comes back when you reload. The test conversation lasts for this tab."
              : "Your assistant, knowledge and workflows are saved in this browser. The test conversation lasts for this tab."}
          </p>
          <div className="settings-actions">
            <Button
              icon={RotateCcw}
              disabled={conversation.busy || conversation.messages.length === 0}
              onClick={() => {
                resetConversation();
                toast("Test conversation cleared", "info");
              }}
            >
              Clear test conversation
            </Button>
            <Button
              variant="danger"
              icon={Trash2}
              onClick={() => confirm.current?.showModal()}
            >
              Reset all practice data
            </Button>
          </div>
        </Panel>
      </div>

      <LiveAiPanel />

      <dialog ref={confirm} className="ui-dialog" aria-labelledby="reset-title">
        <h2 id="reset-title">Reset all practice data?</h2>
        <p>
          This removes your assistant identity, knowledge, workflows and test
          conversation from this browser. It can’t be undone.
        </p>
        <div className="ui-dialog-actions">
          <Button onClick={() => confirm.current?.close()}>Keep my data</Button>
          <Button
            variant="danger"
            onClick={() => {
              try {
                Object.keys(localStorage)
                  .filter((key) => key.startsWith("hellocrew:"))
                  .forEach((key) => localStorage.removeItem(key));
                Object.keys(sessionStorage)
                  .filter((key) => key.startsWith("hellocrew:"))
                  .forEach((key) => sessionStorage.removeItem(key));
              } catch {
                /* storage unavailable */
              }
              // Full reload so every editor re-reads the now-empty storage.
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination
              window.location.assign("/app");
            }}
          >
            Reset everything
          </Button>
        </div>
      </dialog>
    </div>
  );
}
