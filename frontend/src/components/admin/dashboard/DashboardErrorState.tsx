import { DashboardRefreshButton } from './DashboardRefreshButton';
import { AdminIcon } from '../ui/AdminIcon';

interface DashboardErrorStateProps {
  message?: string;
}

/** Non-fatal fetch failure with an explicit retry — never leaks internals. */
export function DashboardErrorState({ message }: DashboardErrorStateProps) {
  return (
    <div className="cc-state cc-state--error" role="alert">
      <span className="cc-state__icon">
        <AdminIcon name="alert" size={18} />
      </span>
      <p className="cc-state__title">Dashboard unavailable</p>
      <p className="cc-state__message">{message ?? 'The dashboard could not be loaded. Please try again.'}</p>
      <div className="cc-state__action">
        <DashboardRefreshButton />
      </div>
    </div>
  );
}
