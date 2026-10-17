"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Check,
  CircleAlert,
  Command,
  Home,
  Inbox,
  Info,
  Menu,
  Monitor,
  Moon,
  Radio,
  Search,
  Settings,
  Sun,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";

import { Brand } from "@/components/brand";
import { useDashboard, type Theme } from "./provider";

type NavItem = { href: string; label: string; icon: LucideIcon; hint: string };

export const dashboardNav: { group: string | null; items: NavItem[] }[] = [
  {
    group: null,
    items: [
      {
        href: "/app",
        label: "Home",
        icon: Home,
        hint: "Overview and next steps",
      },
      {
        href: "/app/inbox",
        label: "Inbox",
        icon: Inbox,
        hint: "Test conversations and approvals",
      },
    ],
  },
  {
    group: "Build",
    items: [
      {
        href: "/app/assistant",
        label: "Assistant",
        icon: Bot,
        hint: "Identity, business and knowledge",
      },
      {
        href: "/app/workflows",
        label: "Workflows",
        icon: Workflow,
        hint: "What it does and when it asks you",
      },
    ],
  },
  {
    group: "Launch",
    items: [
      {
        href: "/app/channels",
        label: "Channels",
        icon: Radio,
        hint: "Website chat and installation",
      },
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
  return href === "/app" ? pathname === "/app" : pathname.startsWith(href);
}

function useResolvedTheme(theme: Theme) {
  const [system, setSystem] = useState<"light" | "dark">("light");
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystem(query.matches ? "dark" : "light");
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return theme === "system" ? system : theme;
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { theme, identity, conversation, toasts, dismissToast } =
    useDashboard();
  const resolved = useResolvedTheme(theme);
  const [navOpen, setNavOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const current =
    allItems.find((item) => isActive(pathname, item.href)) ?? allItems[0];
  const pending =
    conversation.session?.approvals.filter((a) => a.status === "pending")
      .length ?? 0;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    document.title = `${current.label} · HelloCrew`;
  }, [current.label]);

  return (
    <div className="dash" data-theme={resolved}>
      <a className="dash-skip" href="#dash-main">
        Skip to content
      </a>
      <div
        className="dash-scrim"
        data-open={navOpen}
        onClick={() => setNavOpen(false)}
        aria-hidden="true"
      />
      <aside
        className="dash-sidebar"
        data-open={navOpen}
        aria-label="Dashboard"
      >
        <div className="dash-sidebar-top">
          <Link href="/" className="dash-brand" aria-label="HelloCrew website">
            <Brand />
          </Link>
          <button
            type="button"
            className="dash-icon-button dash-only-mobile"
            onClick={() => setNavOpen(false)}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>
        <button
          type="button"
          className="dash-search"
          onClick={() => setCommandOpen(true)}
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
                  onClick={() => setNavOpen(false)}
                >
                  <item.icon size={18} aria-hidden="true" />
                  <span>{item.label}</span>
                  {item.href === "/app/inbox" && pending > 0 && (
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
            onClick={() => setNavOpen(false)}
          >
            <Settings size={18} aria-hidden="true" />
            <span>Settings</span>
          </Link>
          <Link
            href="/app/assistant"
            className="dash-mini-badge"
            onClick={() => setNavOpen(false)}
          >
            <span className="dash-avatar" aria-hidden="true">
              {identity.name.slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>{identity.name}</strong>
              <small>
                <span className="dash-status-dot" aria-hidden="true" /> On duty
                in practice
              </small>
            </span>
          </Link>
        </div>
      </aside>

      <div className="dash-main">
        <header className="dash-topbar">
          <button
            type="button"
            className="dash-icon-button dash-only-mobile"
            onClick={() => setNavOpen(true)}
            aria-label="Open menu"
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
            <ThemeSwitch />
            <button
              type="button"
              className="dash-icon-button dash-only-mobile"
              onClick={() => setCommandOpen(true)}
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
          {children}
        </main>
      </div>

      <CommandMenu open={commandOpen} onClose={() => setCommandOpen(false)} />

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
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { setTheme, resetConversation, toast } = useDashboard();
  const dialog = useRef<HTMLDialogElement>(null);
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
          router.push("/app/inbox");
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

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) {
      setQuery("");
      setIndex(0);
      el.showModal();
    }
    if (!open && el.open) el.close();
  }, [open]);

  function choose(i: number) {
    const command = filtered[i];
    if (!command) return;
    onClose();
    command.run();
  }

  return (
    <dialog
      ref={dialog}
      className="dash-command"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      aria-label="Command menu"
    >
      <div className="dash-command-input">
        <Command size={17} aria-hidden="true" />
        <input
          autoFocus
          value={query}
          placeholder="Type a page or action"
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setIndex((i) => Math.min(i + 1, filtered.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              choose(index);
            }
          }}
          aria-label="Search commands"
        />
        <kbd>Esc</kbd>
      </div>
      <ul role="listbox" className="dash-command-list">
        {filtered.length === 0 && (
          <li className="dash-command-empty">
            No match. Try “inbox” or “dark”.
          </li>
        )}
        {filtered.map((command, i) => (
          <li key={command.id} role="option" aria-selected={i === index}>
            <button
              type="button"
              onMouseEnter={() => setIndex(i)}
              onClick={() => choose(i)}
            >
              <command.icon size={16} aria-hidden="true" />
              <span>{command.label}</span>
              <small>{command.hint}</small>
            </button>
          </li>
        ))}
      </ul>
    </dialog>
  );
}
