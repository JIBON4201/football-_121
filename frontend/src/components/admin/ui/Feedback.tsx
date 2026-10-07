import type { ReactNode } from 'react';
import { AdminIcon, type AdminIconName } from './AdminIcon';
import { AdminButton } from './AdminButton';

/**
 * The three "nothing to show" states, in one file so every page reaches for the
 * same component instead of hand-rolling a card. Each keeps the surrounding
 * panel visible — states never replace the layout.
 */

export function EmptyState({
  title,
  description,
  action,
  icon = 'inbox',
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: AdminIconName;
}) {
  return (
    <div className="cc-empty">
      <span className="cc-empty__icon">
        <AdminIcon name={icon} size={18} />
      </span>
      <p className="cc-empty__title">{title}</p>
      {description ? <p className="cc-empty__description">{description}</p> : null}
      {action ? <div className="cc-empty__action">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetryLabel,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetryLabel?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="cc-state cc-state--error" role="alert">
      <span className="cc-state__icon">
        <AdminIcon name="alert" size={18} />
      </span>
      <p className="cc-state__title">{title}</p>
      <p className="cc-state__message">
        {message ?? 'The request could not be completed. Please try again.'}
      </p>
      {onRetry ? (
        <div className="cc-state__action">
          <AdminButton icon="refresh" onClick={onRetry}>
            {onRetryLabel ?? 'Try again'}
          </AdminButton>
        </div>
      ) : null}
    </div>
  );
}

/** Neutral informational state — used for "no permission to view this section". */
export function InfoState({ title, message }: { title: string; message: string }) {
  return (
    <div className="cc-state">
      <span className="cc-state__icon">
        <AdminIcon name="info" size={18} />
      </span>
      <p className="cc-state__title">{title}</p>
      <p className="cc-state__message">{message}</p>
    </div>
  );
}