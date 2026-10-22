export function Brand({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand ${small ? "small" : ""}`}>
      <span className="brand-flower" aria-hidden="true">
        ✳
      </span>
      HelloCrew<span className="brand-dot">.</span>
    </span>
  );
}

export type BuddyVariant = "green" | "yellow" | "coral";

/**
 * The HelloCrew character. Purely decorative: every place that renders one
 * also names the thing it stands for in text, so it stays aria-hidden.
 */
export function Buddy({
  variant = "green",
  asleep = false,
}: {
  variant?: BuddyVariant;
  asleep?: boolean;
}) {
  return (
    <div className={`buddy ${variant}`} data-asleep={asleep} aria-hidden="true">
      <div className="buddy-eyes">
        <i />
        <i />
      </div>
      <div className="buddy-smile" />
      <span className="buddy-arm left" />
      <span className="buddy-arm right" />
    </div>
  );
}
