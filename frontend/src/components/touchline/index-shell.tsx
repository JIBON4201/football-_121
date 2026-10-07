import type { ReactNode } from "react";
import { EmptyState } from "./empty-state";
import { Icon } from "./icons";

export interface IndexFigure {
  value: string;
  label: string;
}

export function IndexHero({
  eyebrow,
  title,
  description,
  asideLabel,
  figures = [],
  aside,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  asideLabel?: string;
  figures?: IndexFigure[];
  aside?: ReactNode;
}) {
  return (
    <header className="index-hero">
      <div className="index-hero__lead">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description && <p className="index-hero__description">{description}</p>}
      </div>
      {(figures.length > 0 || aside) && (
        <div className="index-hero__aside">
          {asideLabel && <p className="index-hero__aside-label">{asideLabel}</p>}
          {aside}
          {figures.length > 0 && (
            <dl className="index-figures">
              {figures.map((figure) => (
                <div key={figure.label}>
                  <dd>{figure.value}</dd>
                  <dt>{figure.label}</dt>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </header>
  );
}

export function IndexGroup({
  id,
  eyebrow,
  title,
  description,
  count,
  countLabel,
  action,
  tone = "paper",
  className = "",
  children,
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  description?: string;
  count?: number;
  countLabel?: string;
  action?: { label: string; href: string };
  tone?: "paper" | "surface" | "field";
  className?: string;
  children: ReactNode;
}) {
  const headingId = id ? `index-group-${id}` : undefined;
  return (
    <section id={id} className={`index-group index-group--${tone} ${className}`.trim()} aria-labelledby={headingId}>
      <div className="index-group__heading">
        <div className="index-group__titles">
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h2 id={headingId}>{title}</h2>
          {description && <p className="index-group__description">{description}</p>}
        </div>
        {typeof count === "number" && <p className="index-group__count">{countLabel ?? `${count}`}</p>}
        {action && (
          <a className="index-group__action text-link" href={action.href}>
            {action.label}
            <Icon name="arrow-right" size={16} />
          </a>
        )}
      </div>
      {children}
    </section>
  );
}

export function IndexJumpNav({ label, items }: { label: string; items: { href: string; label: string; count?: number }[] }) {
  if (!items.length) return null;
  return (
    <nav className="index-jump" aria-label={label}>
      <span className="index-jump__label">{label}</span>
      <ul>
        {items.map((item) => (
          <li key={item.href}>
            <a href={item.href}>
              {item.label}
              {typeof item.count === "number" && <span className="index-jump__count">{item.count}</span>}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function DirectoryEmpty({ title, description }: { title: string; description: string; expectations?: string[] }) {
  return (
    <div className="directory-empty">
      <EmptyState title={title} description={description} />
    </div>
  );
}
