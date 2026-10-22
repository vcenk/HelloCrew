"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Cloud,
  CloudOff,
  LoaderCircle,
  Check,
  CircleAlert,
  Command,
  Inbox,
  MessageCircle,
  Info,
  Menu,
  Monitor,
  Moon,
  Search,
  Settings,
  Sun,
  Users,
  X,
  Plug,
  type LucideIcon,
} from "lucide-react";

import { Brand } from "@/components/brand";
import { useDashboard, type Theme } from "./provider";

type NavItem = { href: string; label: string; icon: LucideIcon; hint: string };

export const dashboardNav: { group: string | null; items: NavItem[] }[] = [
  {
    group: null,
    items: [
      { href: "/app", label: "Today", icon: Sun, hint: "What needs you and how your crew is doing" },
      { href: "/app/conversations", label: "Conversations", icon: MessageCircle, hint: "Every chat, test and approval" },
      { href: "/app/crew", label: "Crew", icon: Users, hint: "Your agents, their skills and channels" },
      { href: "/app/knowledge", label: "Knowledge", icon: BookOpen, hint: "What your whole crew may say" },
      { href: "/app/connections", label: "Connections", icon: Plug, hint: "Facebook, Instagram, WhatsApp, Google and your website" },
    ],
  },
];

const settingsItem: NavItem = {
  href: "/app/settings",
  label: "Settings",
  icon: Settings,
  hint: "Models, theme and practice data",
};
const allItems: NavItem[] = [
  ...dashboardNav.flatMap((g) => g.items),
  settingsItem,
];

function isActive(pathname: string, href: string) {
  if (href === "/app") return pathname === "/app";
  // The workflow editor is an advanced view of a crew member's skills.
  if (href === "/app/crew" && pathname.startsWith("/app/workflows")) return true;
  return pathname.startsWith(href);
}

function useMediaQuery(query: string) {
  // Starts false so the server and the first client render agree; the layout
  // is the desktop one until the effect runs.
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

function useResolvedTheme(theme: Theme) {
  const dark = useMediaQuery("(prefers-color-scheme: dark)");
  return theme === "system" ? (dark ? "dark" : "light") : theme;
}

// Matches the breakpoint where dashboard.css turns the sidebar into a drawer.
const COMPACT_QUERY = "(max-width: 860px)";

const listId = "dash-command-options";
const optionId = (i: number) => `${listId}-${i}`;

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { theme, identity, conversation, toasts, dismissToast, hydrated } =
    useDashboard();
  const resolved = useResolvedTheme(theme);
  const compact = useMediaQuery(COMPACT_QUERY);
  const [navOpen, setNavOpen] = useState(false);
  const navTrigger = useRef<HTMLButtonElement>(null);
  const navClose = useRef<HTMLButtonElement>(null);
  const commandDialog = useRef<HTMLDialogElement>(null);
  // showModal() throws on an already-open dialog.
  const openCommandMenu = useCallback(() => {
    const el = commandDialog.current;
    if (el && !el.open) el.showModal();
  }, []);
  const restoreNavFocus = useRef(false);
  // Dismissing the drawer hands focus back to the button that opened it;
  // following a link does not, because the page itself is changing.
  const closeNav = useCallback((restoreFocus = false) => {
    restoreNavFocus.current = restoreFocus;
    setNavOpen(false);
  }, []);
  const drawerOpen = compact && navOpen;
  const current =
    allItems.find((item) => isActive(pathname, item.href)) ?? allItems[0];
  const pending =
    (conversation.session?.approvals.filter((a) => a.status === "pending")
      .length ?? 0) +
    conversation.messages.reduce(
      (n, m) =>
        n +
        (m.liveApprovals?.filter((a) => a.status === "pending").length ?? 0),
      0,
    );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        // Toggle the dialog itself rather than a piece of React state. Escape
        // and backdrop clicks close it natively, and React only learns about
        // that a tick later — long enough for a shortcut pressed in between
        // to become an update React skips as a no-op, losing the keypress.
        const el = commandDialog.current;
        if (el?.open) el.close();
        else el?.showModal();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    document.title = `${current.label} · HelloCrew`;
  }, [current.label]);

  // Opening the drawer moves focus into it and Escape closes it again.
  useEffect(() => {
    if (!drawerOpen) return;
    navClose.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeNav(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen, closeNav]);

  // Runs after the drawer is no longer inert, so the trigger can take focus.
  useEffect(() => {
    if (navOpen || !restoreNavFocus.current) return;
    restoreNavFocus.current = false;
    navTrigger.current?.focus();
  }, [navOpen]);

  return (
    <div className="dash" data-theme={resolved}>
      <a className="dash-skip" href="#dash-main">
        Skip to content
      </a>
      <div
        className="dash-scrim"
        data-open={navOpen}
        onClick={() => closeNav(true)}
        aria-hidden="true"
      />
      <aside
        className="dash-sidebar"
        data-open={navOpen}
        aria-label="Dashboard"
        // Off-canvas the drawer is still in the DOM, so without this its links
        // stay tabbable and reachable by screen readers while invisible.
        inert={compact && !navOpen}
      >
        <div className="dash-sidebar-top">
          <Link href="/" className="dash-brand" aria-label="HelloCrew website">
            <Brand />
          </Link>
          <button
            ref={navClose}
            type="button"
            className="dash-icon-button dash-only-mobile"
            onClick={() => closeNav(true)}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>
        <button
          type="button"
          className="dash-search"
          onClick={openCommandMenu}
        >
          <Search size={16} aria-hidden="true" />
          <span>Search or jump to</span>
          <kbd>Ctrl K</kbd>
        </button>
        <nav className="dash-nav">
          {dashboardNav.map((group) => (
            <div className="dash-nav-group" key={group.group ?? "main"}>
              {group.group && (
                <span className="dash-nav-label">{group.group}</span>
              )}
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="dash-nav-link"
                  aria-current={
                    isActive(pathname, item.href) ? "page" : undefined
                  }
                  onClick={() => closeNav()}
                >
                  <item.icon size={18} aria-hidden="true" />
                  <span>{item.label}</span>
                  {item.href === "/app/conversations" && pending > 0 && (
                    <span
                      className="dash-nav-count"
                      aria-label={`${pending} waiting for you`}
                    >
                      {pending}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="dash-sidebar-foot">
          <Link
            href={settingsItem.href}
            className="dash-nav-link"
            aria-current={
              isActive(pathname, settingsItem.href) ? "page" : undefined
            }
            onClick={() => closeNav()}
          >
            <Settings size={18} aria-hidden="true" />
            <span>Settings</span>
          </Link>
          <Link
            href="/app/crew"
            className="dash-mini-badge"
            onClick={() => closeNav()}
          >
            <span className="dash-avatar" aria-hidden="true">
              {identity.name.slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>{identity.name}</strong>
              <small>
                <span className="dash-status-dot" aria-hidden="true" /> Receptionist
                on duty
              </small>
            </span>
          </Link>
        </div>
      </aside>

      {/* While the drawer covers the page, the content behind it is out of
          play — inert keeps Tab and screen readers inside the drawer. */}
      <div className="dash-main" inert={drawerOpen}>
        <header className="dash-topbar">
          <button
            ref={navTrigger}
            type="button"
            className="dash-icon-button dash-only-mobile"
            onClick={() => setNavOpen(true)}
            aria-label="Open menu"
            aria-expanded={navOpen}
          >
            <Menu size={19} />
          </button>
          <div className="dash-crumb">
            <current.icon size={17} aria-hidden="true" />
            <span>{current.label}</span>
          </div>
          <div className="dash-topbar-actions">
            <span
              className="dash-mode"
              title="Answers come from your saved facts. No paid AI calls or real bookings."
            >
              Practice mode
            </span>
            <SaveIndicator />
            <ThemeSwitch />
            <button
              type="button"
              className="dash-icon-button dash-only-mobile"
              onClick={openCommandMenu}
              aria-label="Search"
            >
              <Search size={18} />
            </button>
          </div>
        </header>
        <main
          id="dash-main"
          className="dash-content"
          tabIndex={-1}
          key={pathname}
        >
          {hydrated ? (
            children
          ) : (
            <div
              className="dash-skeleton"
              role="status"
              aria-label="Loading your workspace"
            >
              <span />
              <span />
              <span />
            </div>
          )}
        </main>
      </div>

      <CommandMenu dialogRef={commandDialog} />

      <div className="dash-toasts" aria-live="polite" role="status">
        {toasts.map((t) => (
          <div className="dash-toast" data-tone={t.tone} key={t.id}>
            {t.tone === "error" ? (
              <CircleAlert size={17} />
            ) : t.tone === "info" ? (
              <Info size={17} />
            ) : (
              <Check size={17} />
            )}
            <span>{t.text}</span>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              aria-label="Dismiss"
            >
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function SaveIndicator() {
  const { account, saveStatus, retrySave } = useDashboard();
  if (account.status === "loading") return null;
  if (account.status !== "signed_in")
    return (
      <Link
        href="/login?next=/app"
        className="dash-save"
        data-state="local"
        title="Your setup is saved in this browser only. Sign in to keep it in your workspace."
        hidden={account.status === "unavailable"}
      >
        <CloudOff size={15} aria-hidden="true" />
        <span>Sign in to save</span>
      </Link>
    );
  if (account.role === "viewer")
    return (
      <span className="dash-save" data-state="local">
        <Cloud size={15} aria-hidden="true" />
        <span>View only</span>
      </span>
    );
  const label =
    saveStatus === "saving"
      ? "Saving"
      : saveStatus === "error"
        ? "Not saved. Retry"
        : saveStatus === "conflict"
          ? "Changed elsewhere. Reload"
          : "Saved";
  const actionable = saveStatus === "error" || saveStatus === "conflict";
  return (
    <button
      type="button"
      className="dash-save"
      data-state={saveStatus}
      onClick={actionable ? retrySave : undefined}
      aria-disabled={!actionable}
      title={`Workspace: ${account.workspaceName}`}
      aria-live="polite"
    >
      {saveStatus === "saving" ? (
        <LoaderCircle size={15} className="spin" aria-hidden="true" />
      ) : actionable ? (
        <CircleAlert size={15} aria-hidden="true" />
      ) : (
        <Cloud size={15} aria-hidden="true" />
      )}
      <span>{label}</span>
    </button>
  );
}

function ThemeSwitch() {
  const { theme, setTheme } = useDashboard();
  const options: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "Match system", icon: Monitor },
  ];
  return (
    <div className="dash-theme" role="radiogroup" aria-label="Theme">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={theme === option.value}
          aria-label={option.label}
          title={option.label}
          onClick={() => setTheme(option.value)}
        >
          <option.icon size={15} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

function CommandMenu({
  dialogRef,
}: {
  // The <dialog> is the single source of truth for whether the menu is open:
  // the shell opens and closes it through this ref, and Escape and backdrop
  // clicks go straight to the platform. Mirroring that in React state is what
  // used to drop a Ctrl+K pressed right after a close.
  dialogRef: React.RefObject<HTMLDialogElement | null>;
}) {
  const router = useRouter();
  const { setTheme, resetConversation, toast } = useDashboard();
  const dialog = dialogRef;
  const list = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  const commands = useMemo(
    () => [
      ...allItems.map((item) => ({
        id: item.href,
        label: `Go to ${item.label}`,
        hint: item.hint,
        icon: item.icon,
        run: () => router.push(item.href),
      })),
      {
        id: "new-test",
        label: "Start a new test conversation",
        hint: "Clears the practice chat",
        icon: Inbox,
        run: () => {
          resetConversation();
          router.push("/app/conversations");
          toast("New test conversation started", "info");
        },
      },
      {
        id: "light",
        label: "Use light theme",
        hint: "Appearance",
        icon: Sun,
        run: () => setTheme("light"),
      },
      {
        id: "dark",
        label: "Use dark theme",
        hint: "Appearance",
        icon: Moon,
        run: () => setTheme("dark"),
      },
      {
        id: "system",
        label: "Match system theme",
        hint: "Appearance",
        icon: Monitor,
        run: () => setTheme("system"),
      },
    ],
    [router, resetConversation, setTheme, toast],
  );
  const filtered = commands.filter((c) =>
    `${c.label} ${c.hint}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  // The highlight is derived, not stored, so a narrower query can never leave
  // it pointing past the end of the list.
  const active = filtered.length ? Math.min(index, filtered.length - 1) : 0;

  // The list scrolls at nine or more commands, so follow the highlight.
  useEffect(() => {
    if (!dialog.current?.open) return;
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [dialog, active]);

  function choose(i: number) {
    const command = filtered[i];
    if (!command) return;
    dialog.current?.close();
    command.run();
  }

  return (
    <dialog
      ref={dialog}
      className="dash-command"
      // There is no "opened" event to hook, so the query is cleared on the way
      // out instead; every open therefore starts blank.
      onClose={() => {
        setQuery("");
        setIndex(0);
      }}
      onClick={(event) => {
        if (event.target === dialog.current) dialog.current?.close();
      }}
      aria-label="Command menu"
    >
      <div className="dash-command-input">
        <Command size={17} aria-hidden="true" />
        <input
          autoFocus
          value={query}
          placeholder="Type a page or action"
          // Focus stays on the input while the arrows move the highlight, so
          // the active option has to be named for screen readers.
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={filtered.length > 0}
          aria-controls={filtered.length > 0 ? listId : undefined}
          aria-activedescendant={
            filtered.length > 0 ? optionId(active) : undefined
          }
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              if (filtered.length) setIndex((active + 1) % filtered.length);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              if (filtered.length)
                setIndex((active - 1 + filtered.length) % filtered.length);
            } else if (event.key === "Enter") {
              event.preventDefault();
              choose(active);
            }
          }}
          aria-label="Search commands"
        />
        <kbd>Esc</kbd>
      </div>
      {filtered.length === 0 ? (
        <p className="dash-command-empty" role="status">
          No match. Try “inbox” or “dark”.
        </p>
      ) : (
        /* The options are not focusable on purpose: aria-activedescendant
           keeps keyboard control on the input. */
        <ul
          ref={list}
          id={listId}
          role="listbox"
          aria-label="Commands"
          className="dash-command-list"
        >
          {filtered.map((command, i) => (
            <li
              key={command.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setIndex(i)}
              onClick={() => choose(i)}
            >
              <command.icon size={16} aria-hidden="true" />
              <span>{command.label}</span>
              <small>{command.hint}</small>
            </li>
          ))}
        </ul>
      )}
    </dialog>
  );
}
