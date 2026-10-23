import type { CSSProperties } from "react";

export type CrewRole =
  | "receptionist"
  | "reputation"
  | "inbox"
  | "booking"
  | "account"
  | "generic";

export type CrewState =
  | "idle"
  | "working"
  | "waiting"
  | "attention"
  | "offline"
  | "success";

export type CrewSize = 24 | 32 | 40 | 48 | 64;

/**
 * Original HelloCrew characters. Each role has its own silhouette — a bell, a
 * star crown, an envelope fold, a calendar tab, a tall shield — so they stay
 * apart in greyscale, at 24px, and for anyone who cannot distinguish the
 * colours. Everything is inline SVG on a 48×48 grid: no image requests, no
 * sprite sheet.
 *
 * Colours come from CSS custom properties set per role in dashboard.css, which
 * is what lets the dark theme restate them without touching this file.
 */
const bodies: Record<CrewRole, string> = {
  // Bell: wide, grounded, leaning slightly forward to look attentive.
  receptionist:
    "M24 7c8.2 0 13.4 6 13.4 14.2 0 4.6.9 7.6 2.4 10.4 1 1.9-.3 4.1-2.5 4.1H10.7c-2.2 0-3.5-2.2-2.5-4.1 1.5-2.8 2.4-5.8 2.4-10.4C10.6 13 15.8 7 24 7Z",
  // Star crown: three points across the top read as a star even at 24px.
  reputation:
    "M24 5.5l3.9 5.2 6.2-1.3-1.1 6.3 4.9 3.4c2.6 1.8 3.6 5 3.6 8.6 0 6.1-5.4 10-17.5 10S6.5 33.8 6.5 27.7c0-3.6 1-6.8 3.6-8.6l4.9-3.4-1.1-6.3 6.2 1.3L24 5.5Z",
  // Envelope: squared shoulders with a V fold cut into the head.
  inbox:
    "M12 9h24a5 5 0 0 1 5 5v20a5 5 0 0 1-5 5H12a5 5 0 0 1-5-5V14a5 5 0 0 1 5-5Z",
  // Calendar: square page with two binding tabs standing above it.
  booking:
    "M13 11h22a4 4 0 0 1 4 4v20a4 4 0 0 1-4 4H13a4 4 0 0 1-4-4V15a4 4 0 0 1 4-4Z",
  // Shield: tall crown tapering to a point, the most vertical silhouette.
  account:
    "M24 6l13 4.5v12.2C37 31.5 31.6 38.3 24 42c-7.6-3.7-13-10.5-13-19.3V10.5L24 6Z",
  // Pebble: deliberately the plainest shape, for roles with no identity yet.
  generic:
    "M24 8c9 0 15 5.6 15 14.6S33 39 24 39 9 31.6 9 22.6 15 8 24 8Z",
};

/** Extra marks that make each silhouette unmistakable. */
function Detail({ role }: { role: CrewRole }) {
  switch (role) {
    case "receptionist":
      // Headset band.
      return (
        <path
          d="M15 20a9 9 0 0 1 18 0"
          className="crew-avatar-line"
          fill="none"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      );
    case "reputation":
      return (
        <path
          d="M24 12.6l1.5 3 3.3.5-2.4 2.3.6 3.3-3-1.6-3 1.6.6-3.3-2.4-2.3 3.3-.5 1.5-3Z"
          className="crew-avatar-mark"
        />
      );
    case "inbox":
      // The envelope fold.
      return (
        <path
          d="M9 15l15 11 15-11"
          className="crew-avatar-line"
          fill="none"
          strokeWidth="2.4"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      );
    case "booking":
      return (
        <>
          <rect x="15" y="6" width="4" height="8" rx="2" className="crew-avatar-mark" />
          <rect x="29" y="6" width="4" height="8" rx="2" className="crew-avatar-mark" />
          <path d="M9 20h30" className="crew-avatar-line" strokeWidth="2.2" fill="none" />
        </>
      );
    case "account":
      return (
        <path
          d="M18 23.5l4.2 4.2 8-8.4"
          className="crew-avatar-line"
          fill="none"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    default:
      return null;
  }
}

/** Face placement differs per silhouette so the eyes sit on the body, not the crown. */
const faces: Record<CrewRole, { y: number; gap: number }> = {
  receptionist: { y: 26, gap: 6 },
  reputation: { y: 28, gap: 6 },
  inbox: { y: 30, gap: 6 },
  booking: { y: 30, gap: 6 },
  account: { y: 32, gap: 5.5 },
  generic: { y: 24, gap: 6 },
};

/** Status glyphs: a shape each, never colour on its own. */
function StatusMark({ state }: { state: CrewState }) {
  if (state === "idle") return null;
  const glyph = {
    working: <circle cx="40" cy="40" r="3.2" />,
    waiting: <path d="M40 36.4v3.8l2.4 1.6" fill="none" strokeWidth="2" strokeLinecap="round" />,
    attention: <path d="M40 35.6v4.2m0 3.1v.1" fill="none" strokeWidth="2.4" strokeLinecap="round" />,
    offline: <path d="M36.8 36.8l6.4 6.4" fill="none" strokeWidth="2.2" strokeLinecap="round" />,
    success: <path d="M36.9 40.1l2.3 2.3 4.1-4.6" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />,
  }[state];

  return (
    <g className="crew-avatar-status" data-state={state}>
      <circle cx="40" cy="40" r="8" className="crew-avatar-status-ring" />
      <g className="crew-avatar-status-glyph">{glyph}</g>
    </g>
  );
}

export function CrewAvatar({
  role = "generic",
  state = "idle",
  size = 40,
  label,
  className,
  style,
}: {
  role?: CrewRole;
  state?: CrewState;
  size?: CrewSize;
  /**
   * Give a label only when the avatar is the thing identifying the agent. If
   * the role is already written next to it, leave this out and the avatar is
   * hidden from assistive tech as decoration.
   */
  label?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const face = faces[role];
  const described = Boolean(label);

  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={["crew-avatar", className].filter(Boolean).join(" ")}
      data-role={role}
      data-state={state}
      data-size={size}
      style={style}
      role={described ? "img" : undefined}
      aria-label={described ? label : undefined}
      aria-hidden={described ? undefined : true}
      focusable="false"
    >
      <g className="crew-avatar-body">
        <path d={bodies[role]} className="crew-avatar-shape" />
        <Detail role={role} />
        <g className="crew-avatar-eyes">
          <circle cx={24 - face.gap} cy={face.y} r="2.1" />
          <circle cx={24 + face.gap} cy={face.y} r="2.1" />
        </g>
        <path
          d={`M${24 - 4} ${face.y + 5.2}a4 4 0 0 0 8 0`}
          className="crew-avatar-smile"
          fill="none"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
      </g>
      <StatusMark state={state} />
    </svg>
  );
}

/**
 * Two or three Crewlings overlapping, for places that mean "your crew" rather
 * than one agent. Always decorative: the names belong in text beside it.
 */
export function CrewGroup({
  roles,
  size = 32,
  className,
}: {
  roles: CrewRole[];
  size?: CrewSize;
  className?: string;
}) {
  return (
    <span
      className={["crew-group", className].filter(Boolean).join(" ")}
      aria-hidden="true"
    >
      {roles.slice(0, 3).map((role, i) => (
        <CrewAvatar
          key={`${role}-${i}`}
          role={role}
          size={size}
          // Overlap in px against the avatar's own size. A percentage margin
          // would resolve against the container's width instead and collapse
          // the whole group onto one spot.
          style={i === 0 ? undefined : { marginLeft: -Math.round(size / 3) }}
        />
      ))}
    </span>
  );
}
