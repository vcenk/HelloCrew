import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

function classes(variant: Variant, size: Size, extra?: string) {
  return ["ui-btn", `ui-btn-${variant}`, `ui-btn-${size}`, extra]
    .filter(Boolean)
    .join(" ");
}

export function Button({
  variant = "secondary",
  size = "md",
  icon: Icon,
  className,
  children,
  ...props
}: ComponentProps<"button"> & {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
}) {
  return (
    <button
      type="button"
      className={classes(variant, size, className)}
      {...props}
    >
      {Icon && <Icon size={size === "sm" ? 15 : 16} aria-hidden="true" />}
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = "secondary",
  size = "md",
  icon: Icon,
  className,
  children,
  ...props
}: ComponentProps<typeof Link> & {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
}) {
  return (
    <Link className={classes(variant, size, className)} {...props}>
      {Icon && <Icon size={size === "sm" ? 15 : 16} aria-hidden="true" />}
      {children}
    </Link>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="ui-page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="ui-page-actions">{actions}</div>}
    </div>
  );
}

export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "success" | "attention" | "info";
  children: ReactNode;
}) {
  return <span className={`ui-pill ui-pill-${tone}`}>{children}</span>;
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="ui-empty">
      <span className="ui-empty-icon">
        <Icon size={20} aria-hidden="true" />
      </span>
      <strong>{title}</strong>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Panel({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={["ui-panel", className].filter(Boolean).join(" ")}>
      {(title || actions) && (
        <header className="ui-panel-head">
          {title && <h2>{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}
