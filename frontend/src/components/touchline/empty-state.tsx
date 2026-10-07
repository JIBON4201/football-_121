import { Icon } from "./icons";

interface EmptyStateProps {
  title: string;
  description: string;
  compact?: boolean;
}

export function EmptyState({ title, description, compact = false }: EmptyStateProps) {
  return (
    <div className={`empty-state${compact ? " empty-state--compact" : ""}`} role="status">
      <span className="empty-state__icon" aria-hidden="true"><Icon name="ball" size={20} /></span>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </div>
  );
}

/**
 * A feed that could not be read at all.
 *
 * Reuses the empty-state panel so an outage and an empty feed share one visual
 * language, but the copy never claims a fact the API did not return: it says the
 * data is unavailable, not that there are no matches. `role="alert"` so the
 * failure is announced rather than read as a settled, empty list.
 */
export function ErrorState({ title, description, compact = false }: EmptyStateProps) {
  return (
    <div className={`empty-state${compact ? " empty-state--compact" : ""}`} role="alert">
      <span className="empty-state__icon" aria-hidden="true"><Icon name="ball" size={20} /></span>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </div>
  );
}
