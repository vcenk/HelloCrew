"use client";

import { useRef } from "react";
import { Monitor, Moon, RotateCcw, Sun, Trash2 } from "lucide-react";

import { ModelManagement } from "@/components/model-management";
import { useDashboard, type Theme } from "./provider";
import { Button, PageHeader, Panel } from "./ui";

const themes: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "Match system", icon: Monitor },
];

export function SettingsView() {
  const {
    theme,
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
        description="Appearance, AI models and the practice data stored in this browser."
      />
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
            Your assistant, knowledge and workflows are saved in this browser
            until accounts are connected. The test conversation lasts for this
            tab.
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

      <ModelManagement />

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
