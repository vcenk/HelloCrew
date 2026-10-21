"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Camera,
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
import { Button, EmptyState, PageHeader, Panel, Pill } from "./ui";

const kindLabel: Record<ChannelConnection["kind"], string> = {
  facebook_page: "Facebook Page",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  google_location: "Google Business Profile",
};
const kindIcon = { facebook_page: MessageSquare, instagram: Camera, whatsapp: Phone, google_location: MapPin } as const;

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
  forbidden: "Only owners and operators can connect accounts.",
};

// Loads connections and shows the result of a connect redirect once.
export function useConnections() {
  const { account, toast } = useDashboard();
  const params = useSearchParams();
  const router = useRouter();
  const [connections, setConnections] = useState<ChannelConnection[] | null>(null);
  const [setup, setSetup] = useState<{ meta: boolean; google: boolean; secrets: boolean } | null>(null);
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
  useEffect(() => {
    if (!connected && !error) return;
    if (connected) toast(Number(connected) > 0 ? `${connected} account${connected === "1" ? "" : "s"} connected` : "Nothing was connected", Number(connected) > 0 ? "success" : "info");
    if (error) toast(errorText[error] ?? "Connecting didn’t work. Try again.", "error");
    router.replace(window.location.pathname, { scroll: false });
  }, [connected, error, router, toast]);

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

function ConnectionRow({ connection, onDisconnect }: { connection: ChannelConnection; onDisconnect: () => void }) {
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
      {confirm ? (
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

// Receptionist → Channels: Messenger, Instagram and WhatsApp.
export function MessagingChannelsPanel() {
  const state = useConnections();
  const { toast } = useDashboard();
  const [phoneId, setPhoneId] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [showWhatsApp, setShowWhatsApp] = useState(false);
  if (!state.signedIn)
    return (
      <Panel title="Messenger, Instagram and WhatsApp">
        <p className="settings-copy">Sign in to connect your business accounts.</p>
      </Panel>
    );
  const messaging = (state.connections ?? []).filter((c) => c.kind !== "google_location");
  const metaReady = Boolean(state.setup?.meta && state.setup.secrets);
  return (
    <Panel title="Messenger, Instagram and WhatsApp" className="connections-panel">
      <p className="settings-copy">
        The same receptionist answers private messages on these apps, with your knowledge and skills. Chats land in
        Conversations, and you can take over any time.
      </p>
      {!metaReady && state.setup && (
        <p className="file-note">
          <AlertTriangle size={15} aria-hidden="true" /> Meta isn’t set up on the server yet. See docs/CHANNELS_SETUP.md.
        </p>
      )}
      {messaging.length > 0 && (
        <ul className="connection-list">
          {messaging.map((c) => (
            <ConnectionRow key={c.id} connection={c} onDisconnect={() => void state.disconnect(c)} />
          ))}
        </ul>
      )}
      <div className="connect-actions">
        <a
          className={`ui-btn ui-btn-primary ui-btn-md${metaReady ? "" : " is-disabled"}`}
          href={metaReady ? "/api/connect/meta" : undefined}
          aria-disabled={!metaReady}
        >
          <MessageSquare size={16} aria-hidden="true" /> Connect Facebook & Instagram
        </a>
        <Button icon={Phone} disabled={!metaReady} onClick={() => setShowWhatsApp((v) => !v)}>
          Connect WhatsApp
        </Button>
      </div>
      {showWhatsApp && (
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
            setShowWhatsApp(false);
            toast("WhatsApp connected");
            void state.refresh();
          }}
        >
          <p className="settings-copy">
            From your Meta app: WhatsApp → API Setup. Until HelloCrew is approved by Meta, this uses your app’s test
            number or your own number.
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
          <small className="today-note">The token is encrypted and only used by the server to send replies.</small>
          <div className="form-actions">
            <Button type="submit" variant="primary" icon={Check} disabled={busy || !phoneId || token.length < 20}>
              Connect
            </Button>
          </div>
        </form>
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
  const state = useConnections();
  const replies = usePublicReplies();
  const sources = (state.connections ?? []).filter((c) => c.kind !== "whatsapp");
  const metaReady = Boolean(state.setup?.meta && state.setup.secrets);
  const googleReady = Boolean(state.setup?.google && state.setup.secrets);
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
          <Panel title="Connected">
            {!state.signedIn ? (
              <p className="settings-copy">Sign in to connect accounts.</p>
            ) : (
              <>
                {sources.length > 0 ? (
                  <ul className="connection-list">
                    {sources.map((c) => (
                      <ConnectionRow key={c.id} connection={c} onDisconnect={() => void state.disconnect(c)} />
                    ))}
                  </ul>
                ) : (
                  <p className="settings-copy">No review or social accounts yet.</p>
                )}
                <div className="connect-actions stacked">
                  <a className={`ui-btn ui-btn-secondary ui-btn-md${googleReady ? "" : " is-disabled"}`} href={googleReady ? "/api/connect/google" : undefined} aria-disabled={!googleReady}>
                    <MapPin size={16} aria-hidden="true" /> Connect Google reviews
                  </a>
                  <a className={`ui-btn ui-btn-secondary ui-btn-md${metaReady ? "" : " is-disabled"}`} href={metaReady ? "/api/connect/meta" : undefined} aria-disabled={!metaReady}>
                    <MessageSquare size={16} aria-hidden="true" /> Connect Facebook & Instagram
                  </a>
                </div>
                {state.setup && (!googleReady || !metaReady) && (
                  <p className="today-note">
                    {!googleReady && "Google needs server setup and API approval. "}
                    {!metaReady && "Meta needs server setup. "}See docs/CHANNELS_SETUP.md.
                  </p>
                )}
                <p className="today-note">Google reviews are checked every 30 minutes; Facebook and Instagram comments arrive instantly.</p>
              </>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}
