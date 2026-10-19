"use client";

import { useEffect, useState } from "react";
import { BellRing, Check, Send } from "lucide-react";

import {
  getAlertSettings,
  saveAlertSettings,
  sendTestAlert,
  type AlertSettings,
} from "@/app/app/alert-actions";
import { useDashboard } from "./provider";
import { Button, Panel, Pill } from "./ui";

const toggles: {
  key: keyof Omit<AlertSettings, "email">;
  label: string;
  hint: string;
}[] = [
  {
    key: "onApproval",
    label: "A booking needs my OK",
    hint: "Booking requests from your website chat.",
  },
  {
    key: "onHandoff",
    label: "A customer asks for a person",
    hint: "Complaints, refunds or a direct request.",
  },
  {
    key: "onLead",
    label: "A new lead",
    hint: "Someone left their phone or email for a follow-up.",
  },
  {
    key: "onNewChat",
    label: "Every new website chat",
    hint: "Can be a lot on busy days.",
  },
];

export function AlertsPanel() {
  const { account, toast } = useDashboard();
  const [settings, setSettings] = useState<AlertSettings | null>(null);
  const [saved, setSaved] = useState<AlertSettings | null>(null);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (account.status !== "signed_in") return;
    let cancelled = false;
    void getAlertSettings().then((result) => {
      if (cancelled || !result.ok) return;
      setSettings(result.settings);
      setSaved(result.settings);
      setAccountEmail(result.accountEmail);
      setReady(result.emailReady);
    });
    return () => {
      cancelled = true;
    };
  }, [account.status]);

  if (account.status !== "signed_in")
    return (
      <Panel title="Email alerts">
        <p className="settings-copy">
          Sign in to get an email when your crew needs you.
        </p>
      </Panel>
    );
  if (!settings)
    return (
      <Panel title="Email alerts">
        <p className="settings-copy">Loading…</p>
      </Panel>
    );

  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);

  return (
    <Panel
      title="Email alerts"
      className="alerts-panel"
      actions={
        <Pill tone={ready ? "success" : "neutral"}>
          {ready ? "On" : "Needs setup"}
        </Pill>
      }
    >
      {!ready && (
        <p className="file-note">
          <BellRing size={15} aria-hidden="true" /> Email sending isn’t set up
          on the server yet. Your choices are saved and start working once it
          is.
        </p>
      )}
      <p className="settings-copy">
        Only for real website chats. Your own test chats never send emails.
      </p>
      <div className="field">
        <label htmlFor="alert-email">Send to</label>
        <input
          id="alert-email"
          type="email"
          maxLength={254}
          placeholder={accountEmail ?? "you@business.com"}
          value={settings.email}
          onChange={(e) => setSettings({ ...settings, email: e.target.value })}
        />
        <small>
          Leave empty to use your sign-in email
          {accountEmail ? ` (${accountEmail})` : ""}.
        </small>
      </div>
      <div className="alert-toggles">
        {toggles.map((t) => (
          <label className="switch switch-row" key={t.key}>
            <input
              type="checkbox"
              checked={settings[t.key]}
              onChange={(e) =>
                setSettings({ ...settings, [t.key]: e.target.checked })
              }
            />
            <span aria-hidden="true" />
            <div>
              <strong>{t.label}</strong>
              <small>{t.hint}</small>
            </div>
          </label>
        ))}
      </div>
      <div className="form-actions">
        <Button
          size="sm"
          icon={Send}
          disabled={!ready || busy || dirty}
          title={dirty ? "Save first" : undefined}
          onClick={async () => {
            setBusy(true);
            const result = await sendTestAlert().catch(() => null);
            setBusy(false);
            toast(
              result?.ok
                ? "Test email sent"
                : result && !result.ok
                  ? result.error
                  : "The test didn’t send.",
              result?.ok ? "success" : "error",
            );
          }}
        >
          Send a test
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon={Check}
          disabled={!dirty || busy}
          onClick={async () => {
            setBusy(true);
            const result = await saveAlertSettings(settings).catch(() => null);
            setBusy(false);
            if (result?.ok) {
              setSaved(settings);
              toast("Alert settings saved");
            } else
              toast(
                result && !result.ok ? result.error : "Couldn’t save.",
                "error",
              );
          }}
        >
          Save
        </Button>
      </div>
    </Panel>
  );
}
