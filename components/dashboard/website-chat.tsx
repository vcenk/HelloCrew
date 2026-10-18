"use client";

import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Globe, Plus, X, Zap } from "lucide-react";

import {
  createWebsiteChat,
  getWebsiteChat,
  updateWebsiteChat,
  type WebsiteChat,
} from "@/app/app/widget-actions";
import { normalizeOrigin } from "@/lib/widget";
import { useDashboard } from "./provider";
import { Button, ButtonLink, Panel, Pill } from "./ui";

export function WebsiteChatSetup() {
  const { identity, liveStatus, toast } = useDashboard();
  const [chat, setChat] = useState<WebsiteChat | null | undefined>(undefined);
  const [origins, setOrigins] = useState<string[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [site, setSite] = useState("");

  useEffect(() => {
    let cancelled = false;
    void getWebsiteChat().then((result) => {
      if (cancelled) return;
      setSite(window.location.origin);
      if (!result.ok) {
        setChat(null);
        setError(result.error);
        return;
      }
      setChat(result.chat);
      setOrigins(result.chat?.allowedOrigins ?? []);
      setEnabled(result.chat?.enabled ?? true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const live = liveStatus?.state === "ready" && liveStatus.enabled;
  const dirty =
    chat !== null && chat !== undefined &&
    (enabled !== chat.enabled || JSON.stringify(origins) !== JSON.stringify(chat.allowedOrigins));

  async function create() {
    setSaving(true);
    const result = await createWebsiteChat();
    setSaving(false);
    if (!result.ok || !result.chat) {
      setError(result.ok ? "Couldn’t create your website chat." : result.error);
      return;
    }
    setError("");
    setChat(result.chat);
    setOrigins(result.chat.allowedOrigins);
    setEnabled(result.chat.enabled);
    toast("Website chat created");
  }

  function addOrigin() {
    const origin = normalizeOrigin(input);
    if (!origin) {
      setError("Enter a website address like https://yourbusiness.com");
      return;
    }
    if (origins.length >= 10) {
      setError("Up to 10 websites.");
      return;
    }
    setError("");
    setInput("");
    if (!origins.includes(origin)) setOrigins([...origins, origin]);
  }

  async function save() {
    setSaving(true);
    const result = await updateWebsiteChat({ allowedOrigins: origins, enabled });
    setSaving(false);
    if (!result.ok || !result.chat) {
      setError(result.ok ? "Couldn’t save." : result.error);
      return;
    }
    setError("");
    setChat(result.chat);
    toast("Website chat saved");
  }

  if (chat === undefined)
    return (
      <Panel title="Website chat">
        <p className="today-note">Loading…</p>
      </Panel>
    );

  if (chat === null)
    return (
      <Panel title="Put your receptionist on your website">
        <p className="tab-intro">
          {identity.name} answers visitors from your approved knowledge. Chats land in Conversations, booking
          requests wait for you on Today, and you can take over any chat.
        </p>
        {error && <p className="form-error">{error}</p>}
        <Button variant="primary" icon={Globe} disabled={saving} onClick={() => void create()}>
          Create website chat
        </Button>
      </Panel>
    );

  const snippet = `<script src="${site}/widget.js" data-installation="${chat.publicId}" async></script>`;

  return (
    <Panel
      title="Website chat"
      className="website-chat"
      actions={
        <Pill tone={chat.enabled ? "success" : "neutral"}>
          {chat.enabled ? (chat.allowedOrigins.length ? "Live" : "Test page only") : "Off"}
        </Pill>
      }
    >
      <div className="website-chat-engine">
        <Zap size={16} aria-hidden="true" />
        <span>
          {live ? (
            <>Visitors get <b>Live AI</b> replies, within your monthly budget.</>
          ) : (
            <>
              Visitors get free <b>rule-based</b> replies. Turn on Live AI in Settings for smarter answers.
            </>
          )}
        </span>
      </div>

      <div className="field">
        <label htmlFor="wc-site">Websites allowed to show the chat</label>
        <div className="origin-add">
          <input
            id="wc-site"
            placeholder="https://yourbusiness.com"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addOrigin();
              }
            }}
          />
          <Button icon={Plus} onClick={addOrigin}>
            Add
          </Button>
        </div>
        <small>
          The chat refuses to load anywhere else. Until you add one, it only works on the HelloCrew test page.
        </small>
      </div>
      {origins.length > 0 && (
        <ul className="origin-list">
          {origins.map((origin) => (
            <li key={origin}>
              <Globe size={14} aria-hidden="true" />
              <span>{origin}</span>
              <button
                type="button"
                className="dash-icon-button"
                aria-label={`Remove ${origin}`}
                onClick={() => setOrigins(origins.filter((o) => o !== origin))}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <label className="switch">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span aria-hidden="true" />
        Chat is on
      </label>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <Button variant="primary" icon={Check} disabled={!dirty || saving} onClick={() => void save()}>
          Save
        </Button>
      </div>

      <div className="field">
        <label htmlFor="wc-snippet">Add this line to your website, before &lt;/body&gt;</label>
        <div className="snippet">
          <code id="wc-snippet">{snippet}</code>
          <Button
            size="sm"
            icon={copied ? Check : Copy}
            onClick={() => {
              void navigator.clipboard?.writeText(snippet).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              });
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>
      <ButtonLink
        href={`/widget-test?installation=${chat.publicId}`}
        target="_blank"
        rel="noopener"
        variant="secondary"
        icon={ExternalLink}
      >
        Try it on the test page
      </ButtonLink>
    </Panel>
  );
}
