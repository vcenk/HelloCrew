"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  Camera,
  Globe,
  Check,
  MapPin,
  MessageSquare,
  Phone,
  Send,
  Star,
  Unplug,
  X,
} from "lucide-react";

import {
  channelSetupStatus,
  connectWhatsAppTest,
  decidePublicReply,
  disconnectConnection,
  listConnections,
  listPublicReplies,
  type ChannelConnection,
  type PublicReplyItem,
} from "@/app/app/channel-actions";
import { postingModeHelp, postingModeLabel, postingModeOf, postingModes, setPostingMode } from "@/lib/crew";

import { useDashboard } from "./provider";
import { useDropTransientParams, useQueryState } from "./use-query-state";
import { Button, ButtonLink, EmptyState, PageHeader, Panel, Pill } from "./ui";
import { WebsiteChatSetup } from "./website-chat";
import { WhatsAppSignupButton } from "./whatsapp-signup";

const kindLabel: Record<ChannelConnection["kind"], string> = {
  facebook_page: "Facebook Page",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  google_location: "Google Business Profile",
  google_calendar: "Google Calendar",
};
const kindIcon = { facebook_page: MessageSquare, instagram: Camera, whatsapp: Phone, google_location: MapPin, google_calendar: CalendarDays } as const;

const errorText: Record<string, string> = {
  meta_not_configured: "Meta isn’t set up on the server yet (app id, secret and encryption key).",
  meta_cancelled: "Facebook login was cancelled.",
  meta_state: "The Facebook login expired. Try again.",
  meta_login: "Facebook didn’t accept the login. Check the app’s settings and that you have a role on it.",
  meta_no_pages: "No Facebook Pages were shared. Choose at least one Page when Facebook asks.",
  meta_taken: "One of the Pages is already connected to another HelloCrew workspace.",
  google_not_configured: "Google isn’t set up on the server yet (OAuth client and encryption key).",
  google_cancelled: "Google sign-in was cancelled.",
  google_state: "The Google sign-in expired. Try again.",
  google_login: "Google didn’t accept the sign-in.",
  google_no_refresh: "Google didn’t grant offline access. Remove HelloCrew from your Google account’s connected apps and try again.",
  google_not_approved: "Google hasn’t approved Business Profile API access for HelloCrew yet.",
  google_no_locations: "This Google account doesn’t manage any business locations.",
  google_taken: "One of the locations is already connected to another HelloCrew workspace.",
  gcal_no_calendar: "That Google account has no calendar HelloCrew can write to.",
  gcal_taken: "That calendar is already connected to another HelloCrew workspace.",
  gcal_save: "The calendar connected, but saving it failed. Try again.",
  forbidden: "Only owners and operators can connect accounts.",
};

// Loads connections and shows the result of a connect redirect once.
export function useConnections() {
  const { account, toast } = useDashboard();
  const params = useSearchParams();
  const [connections, setConnections] = useState<ChannelConnection[] | null>(null);
  const [setup, setSetup] = useState<Awaited<ReturnType<typeof channelSetupStatus>> | null>(null);
  const signedIn = account.status === "signed_in";

  const refresh = useCallback(async () => {
    if (!signedIn) return;
    const [list, status] = await Promise.all([listConnections().catch(() => null), channelSetupStatus().catch(() => null)]);
    if (list?.ok) setConnections(list.connections);
    if (status) setSetup(status);
  }, [signedIn]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const connected = params.get("connected");
  const error = params.get("error");
  const dropTransient = useDropTransientParams();
  useEffect(() => {
    if (!connected && !error) return;
    if (connected) toast(Number(connected) > 0 ? `${connected} account${connected === "1" ? "" : "s"} connected` : "Nothing was connected", Number(connected) > 0 ? "success" : "info");
    if (error) toast(errorText[error] ?? "Connecting didn’t work. Try again.", "error");
    // Only the one-shot OAuth result goes; an expanded connector stays put.
    dropTransient(["connected", "error"]);
  }, [connected, error, dropTransient, toast]);

  const disconnect = useCallback(
    async (connection: ChannelConnection) => {
      const result = await disconnectConnection(connection.id).catch(() => null);
      if (!result?.ok) return toast(result?.error ?? "Couldn’t disconnect.", "error");
      setConnections((list) => list?.filter((c) => c.id !== connection.id) ?? null);
      toast(`${connection.displayName} disconnected`, "info");
    },
    [toast],
  );

  return { signedIn, connections, setup, refresh, disconnect };
}

function ConnectionRow({
  connection,
  onDisconnect,
  readOnly = false,
}: {
  connection: ChannelConnection;
  onDisconnect?: () => void;
  readOnly?: boolean;
}) {
  const [confirm, setConfirm] = useState(false);
  const Icon = kindIcon[connection.kind];
  return (
    <li className="connection-row" data-error={Boolean(connection.lastError)}>
      <span className="file-card-icon" aria-hidden="true">
        <Icon size={16} />
      </span>
      <span className="file-card-text">
        <strong>{connection.displayName}</strong>
        <small>{connection.lastError ? connection.lastError : kindLabel[connection.kind]}</small>
      </span>
      {connection.lastError ? <Pill tone="attention">Check</Pill> : <Pill tone="success">Connected</Pill>}
      {readOnly ? null : confirm ? (
        <Button size="sm" variant="danger" icon={Unplug} onClick={onDisconnect}>
          Disconnect
        </Button>
      ) : (
        <button type="button" className="dash-icon-button" aria-label={`Disconnect ${connection.displayName}`} onClick={() => setConfirm(true)}>
          <X size={15} />
        </button>
      )}
    </li>
  );
}

type ConnectorId = "meta" | "whatsapp" | "google" | "google_calendar" | "website";

const connectors: {
  id: ConnectorId;
  name: string;
  icon: typeof MessageSquare;
  kinds: ChannelConnection["kind"][];
  summary: string;
  usedBy: string;
}[] = [
  {
    id: "meta",
    name: "Facebook & Instagram",
    icon: MessageSquare,
    kinds: ["facebook_page", "instagram"],
    summary: "Messenger and Instagram messages, plus comments on your posts. One login connects a Page and its Instagram.",
    usedBy: "Receptionist (messages) · Reputation manager (comments)",
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    icon: Phone,
    kinds: ["whatsapp"],
    summary: "WhatsApp messages to your business number.",
    usedBy: "Receptionist",
  },
  {
    id: "google",
    name: "Google Business Profile",
    icon: MapPin,
    kinds: ["google_location"],
    summary: "Your Google reviews, checked every 30 minutes.",
    usedBy: "Reputation manager",
  },
  {
    id: "google_calendar",
    name: "Google Calendar",
    icon: CalendarDays,
    kinds: ["google_calendar"],
    summary:
      "Read when you are free, so the crew only offers real times. Every booking still waits for your approval.",
    usedBy: "Receptionist (proposes times) · you (approve)",
  },
];

// Where each connector's OAuth starts. Calendar is separate from Business
// Profile: different scope, and a salon may want one without the other.
const connectHref: Partial<Record<ConnectorId, string>> = {
  meta: "/api/connect/meta",
  google: "/api/connect/google",
  google_calendar: "/api/connect/google-calendar",
};

const comingSoon = [
  { name: "Phone calls", icon: Phone, summary: "A phone number your crew answers." },
  { name: "Booking systems", icon: CalendarDays, summary: "Square, Vagaro and others, so times come straight from the system you already use." },
];

function WhatsAppForm({ onDone }: { onDone: () => void }) {
  const { toast } = useDashboard();
  const [phoneId, setPhoneId] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="form-stack whatsapp-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const result = await connectWhatsAppTest({ phoneNumberId: phoneId, accessToken: token }).catch(() => null);
        setBusy(false);
        if (!result?.ok) return toast(result?.error ?? "Couldn’t connect WhatsApp.", "error");
        setToken("");
        setPhoneId("");
        toast("WhatsApp connected");
        onDone();
      }}
    >
      <p className="settings-copy">
        Until Meta approves one-click WhatsApp signup for HelloCrew, connect a number with its ID and a system-user
        token from your Meta app (WhatsApp → API Setup).
      </p>
      <div className="field-row">
        <div className="field">
          <label htmlFor="wa-phone">Phone number ID</label>
          <input id="wa-phone" inputMode="numeric" value={phoneId} onChange={(e) => setPhoneId(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="wa-token">Access token</label>
          <input id="wa-token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
        </div>
      </div>
      <small className="today-note">The token is encrypted and only used by the server.</small>
      <div className="form-actions">
        <Button type="submit" variant="primary" icon={Check} disabled={busy || !phoneId || token.length < 20}>
          Connect
        </Button>
      </div>
    </form>
  );
}

// Settings-style page: every account the crew can work on, in one place.
export function ConnectionsView() {
  const state = useConnections();
  const { account } = useDashboard();
  // Which connector is expanded lives in the URL, so a half-finished setup
  // survives a refresh and Back closes it again.
  const [openParam, setOpenParam] = useQueryState("open");
  const open = (openParam as ConnectorId | null) ?? null;
  const setOpen = (next: ConnectorId | null) => setOpenParam(next);
  const signedIn = account.status === "signed_in";
  const ready = {
    meta: Boolean(state.setup?.meta && state.setup.secrets),
    whatsapp: Boolean(state.setup?.meta && state.setup.secrets),
    google: Boolean(state.setup?.google && state.setup.secrets),
  };
  const websiteOpen = open === "website";
  return (
    <div className="connections-page">
      <PageHeader
        title="Connections"
        description="Connect your business accounts once. Your whole crew uses them, each for its own job."
      />
      <ul className="connector-list" aria-label="Connections">
        {connectors.map((connector) => {
          const accounts = (state.connections ?? []).filter((c) => connector.kinds.includes(c.kind));
          const Icon = connector.icon;
          const available = signedIn && ready[connector.id as "meta" | "whatsapp" | "google"];
          return (
            <li key={connector.id} className="connector">
              <div className="connector-head">
                <span className="connector-icon" data-connector={connector.id} aria-hidden="true">
                  <Icon size={18} />
                </span>
                <span className="connector-text">
                  <strong>{connector.name}</strong>
                  <small>{connector.summary}</small>
                  <small className="connector-used">Used by: {connector.usedBy}</small>
                </span>
                {connector.id === "whatsapp" ? (
                  state.setup?.whatsappSignup && available ? (
                    <WhatsAppSignupButton
                      config={state.setup.whatsappSignup}
                      label={accounts.length ? "Add number" : "Connect"}
                      variant={accounts.length ? "secondary" : "primary"}
                      onConnected={() => void state.refresh()}
                    />
                  ) : (
                    <Button
                      size="sm"
                      variant={accounts.length ? "secondary" : "primary"}
                      disabled={!available}
                      onClick={() => setOpen(open === "whatsapp" ? null : "whatsapp")}
                    >
                      {accounts.length ? "Add number" : "Connect"}
                    </Button>
                  )
                ) : (
                  <a
                    className={`ui-btn ui-btn-${accounts.length ? "secondary" : "primary"} ui-btn-sm${available ? "" : " is-disabled"}`}
                    href={available ? connectHref[connector.id] : undefined}
                    aria-disabled={!available}
                  >
                    {accounts.length ? "Add more" : "Connect"}
                  </a>
                )}
              </div>
              {accounts.length > 0 && (
                <ul className="connection-list">
                  {accounts.map((c) => (
                    <ConnectionRow key={c.id} connection={c} onDisconnect={() => void state.disconnect(c)} />
                  ))}
                </ul>
              )}
              {connector.id === "whatsapp" && state.setup?.whatsappSignup && available && open !== "whatsapp" && (
                <button type="button" className="connector-alt" onClick={() => setOpen("whatsapp")}>
                  Developer option: connect with a phone number ID and token
                </button>
              )}
              {connector.id === "whatsapp" && open === "whatsapp" && (
                <WhatsAppForm
                  onDone={() => {
                    setOpen(null);
                    void state.refresh();
                  }}
                />
              )}
              {signedIn && state.setup && !ready[connector.id as "meta" | "whatsapp" | "google"] && (
                <p className="today-note">
                  <AlertTriangle size={13} aria-hidden="true" />{" "}
                  {connector.id === "google" ? "Waiting for server setup and Google’s API approval." : "Waiting for server setup."}
                </p>
              )}
            </li>
          );
        })}
        <li className="connector">
          <div className="connector-head">
            <span className="connector-icon" data-connector="website" aria-hidden="true">
              <Globe size={18} />
            </span>
            <span className="connector-text">
              <strong>Website chat</strong>
              <small>A chat bubble on your own website, with one line of code.</small>
              <small className="connector-used">Used by: Receptionist</small>
            </span>
            <Button size="sm" disabled={!signedIn} onClick={() => setOpen(websiteOpen ? null : "website")}>
              {websiteOpen ? "Close" : "Set up"}
            </Button>
          </div>
        </li>
        {comingSoon.map((item) => (
          <li key={item.name} className="connector" data-soon="true">
            <div className="connector-head">
              <span className="connector-icon" aria-hidden="true">
                <item.icon size={18} />
              </span>
              <span className="connector-text">
                <strong>{item.name}</strong>
                <small>{item.summary}</small>
              </span>
              <Pill tone="neutral">Coming soon</Pill>
            </div>
          </li>
        ))}
      </ul>
      {!signedIn && <p className="today-note">Sign in to connect your accounts.</p>}
      {websiteOpen && <WebsiteChatSetup />}
    </div>
  );
}

// On an agent's page: the accounts it works on (managed in Connections).
export function WorksOnPanel({ agent }: { agent: "receptionist" | "reputation" }) {
  const state = useConnections();
  if (!state.signedIn) return null;
  const kinds: ChannelConnection["kind"][] =
    agent === "receptionist" ? ["facebook_page", "instagram", "whatsapp"] : ["facebook_page", "instagram", "google_location"];
  const accounts = (state.connections ?? []).filter((c) => kinds.includes(c.kind));
  return (
    <Panel
      title="Works on"
      actions={
        <ButtonLink href="/app/connections" size="sm" variant="ghost">
          Manage connections
        </ButtonLink>
      }
    >
      {agent === "receptionist" && (
        <p className="settings-copy">
          Messages on these accounts and your website chat are answered with your knowledge and skills. Chats land in
          Conversations, and you can take over any time.
        </p>
      )}
      {accounts.length || agent === "receptionist" ? (
        <ul className="connection-list">
          {agent === "receptionist" && (
            <li className="connection-row">
              <span className="file-card-icon" aria-hidden="true">
                <Globe size={16} />
              </span>
              <span className="file-card-text">
                <strong>Website chat</strong>
                <small>Your own website · set up in Connections</small>
              </span>
              <ButtonLink href="/app/connections?open=website" size="sm" variant="ghost">
                Set up
              </ButtonLink>
            </li>
          )}
          {accounts.map((c) => (
            <ConnectionRow key={c.id} connection={c} readOnly />
          ))}
        </ul>
      ) : (
        <p className="settings-copy">
          No accounts yet. <a href="/app/connections">Connect Facebook, Instagram or Google →</a>
        </p>
      )}
      {agent === "reputation" && (
        <p className="today-note">Google reviews are checked every 30 minutes; Facebook and Instagram comments arrive instantly.</p>
      )}
    </Panel>
  );
}

const replyKindLabel: Record<PublicReplyItem["kind"], string> = {
  facebook_comment: "Facebook comment",
  instagram_comment: "Instagram comment",
  google_review: "Google review",
  facebook_recommendation: "Facebook recommendation",
};

export function usePublicReplies() {
  const { account } = useDashboard();
  const [items, setItems] = useState<PublicReplyItem[]>([]);
  const refresh = useCallback(async () => {
    if (account.status !== "signed_in") return;
    const result = await listPublicReplies().catch(() => null);
    if (result?.ok) setItems(result.items);
  }, [account.status]);
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);
  return { items, setItems, refresh };
}

export function PublicReplyCard({ item, onDone }: { item: PublicReplyItem; onDone: (id: string) => void }) {
  const { toast } = useDashboard();
  const [text, setText] = useState(item.draft ?? "");
  const [busy, setBusy] = useState(false);
  async function decide(action: "post" | "skip") {
    setBusy(true);
    const result = await decidePublicReply({ id: item.id, action, text }).catch(() => null);
    setBusy(false);
    if (!result?.ok) return toast(result?.error ?? "That didn’t work.", "error");
    toast(action === "post" ? "Reply posted" : "Skipped", action === "post" ? "success" : "info");
    onDone(item.id);
  }
  return (
    <li className="public-reply" data-status={item.status}>
      <header>
        <span className="decision-icon" data-tone="teach" aria-hidden="true">
          {item.kind === "google_review" ? <Star size={17} /> : item.kind === "instagram_comment" ? <Camera size={17} /> : <MessageSquare size={17} />}
        </span>
        <div>
          <strong>
            {item.authorName ?? "Someone"} · {replyKindLabel[item.kind]}
            {item.rating != null && <span className="stars"> {"★".repeat(item.rating)}{"☆".repeat(5 - item.rating)}</span>}
          </strong>
          <p>{item.body || "(rating only, no text)"}</p>
        </div>
      </header>
      {item.error && <p className="form-error">{item.error}</p>}
      <label className="sr-only" htmlFor={`reply-${item.id}`}>
        Your reply
      </label>
      <textarea
        id={`reply-${item.id}`}
        rows={3}
        maxLength={1500}
        placeholder={item.draft ? undefined : "No suggested reply. Write one, or skip."}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="decision-actions">
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void decide("skip")}>
          Skip
        </Button>
        <Button size="sm" variant="primary" icon={Send} disabled={busy || !text.trim()} onClick={() => void decide("post")}>
          Post reply
        </Button>
      </div>
    </li>
  );
}

// Crew → Reputation manager.
function PostingModePanel() {
  const { crew, saveCrew, toast } = useDashboard();
  const mode = postingModeOf(crew);
  return (
    <Panel title="When replies are posted">
      <div className="segmented posting-mode" role="radiogroup" aria-label="When replies are posted">
        {postingModes.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            onClick={() => {
              if (mode === value) return;
              saveCrew(setPostingMode(crew, value));
              toast(`Replies: ${postingModeLabel[value]}`);
            }}
          >
            {postingModeLabel[value]}
          </button>
        ))}
      </div>
      <p className="today-note">{postingModeHelp[mode]}</p>
    </Panel>
  );
}

export function ReputationView() {
  const replies = usePublicReplies();
  return (
    <div className="reputation">
      <PageHeader
        title="Reputation manager"
        description="Drafts replies to your Google reviews and Facebook and Instagram comments. You choose which ones post on their own."
      />
      <div className="knowledge-grid">
        <div className="knowledge-main">
          <PostingModePanel />
          <Panel title="Waiting for your OK" actions={replies.items.length ? <Pill tone="attention">{replies.items.length}</Pill> : undefined}>
            {replies.items.length === 0 ? (
              <EmptyState icon={Star} title="Nothing to reply to">
                New reviews and comments appear here with a suggested reply.
              </EmptyState>
            ) : (
              <ul className="public-reply-list">
                {replies.items.map((item) => (
                  <PublicReplyCard key={item.id} item={item} onDone={(id) => replies.setItems((l) => l.filter((i) => i.id !== id))} />
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <aside className="knowledge-side">
          <WorksOnPanel agent="reputation" />
        </aside>
      </div>
    </div>
  );
}
