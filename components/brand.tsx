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
export function Buddy({ variant = "green" }: { variant?: "green" | "yellow" }) {
  return (
    <div className={`buddy ${variant}`} aria-hidden="true">
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
