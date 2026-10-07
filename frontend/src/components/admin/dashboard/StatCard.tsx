interface StatCardProps {
  label: string;
  value: number;
  /** Secondary line: a real breakdown of the same metric, never invented. */
  sub?: string;
  /** Admin route the card links to. Omit when no management page exists. */
  href?: string;
}

/**
 * Compact KPI card for the Admin Dashboard. Server-rendered, no client JS.
 * Clickable only when an `href` points at a real management page.
 */
export function StatCard({ label, value, sub, href }: StatCardProps) {
  const formatted = Number.isFinite(value) ? value.toLocaleString('en-GB') : '—';
  const body = (
    <>
      <p className="cc-stat__label">{label}</p>
      <p className="cc-stat__value">{formatted}</p>
      {sub ? <p className="cc-stat__sub">{sub}</p> : null}
    </>
  );
  if (!href) {
    return <div className="cc-stat">{body}</div>;
  }
  return (
    <a className="cc-stat cc-stat--link" href={href} aria-label={`${label}: ${formatted}. Manage ${label.toLowerCase()}`}>
      {body}
    </a>
  );
}