import { DashboardRefreshButton } from './dashboard/DashboardRefreshButton';
import { AdminIcon } from './ui/AdminIcon';

interface AdminErrorStateProps {
  title?: string;
  message?: string;
}

/** Generic Admin surface error state with an explicit retry control. */
export function AdminErrorState({ title = 'Something went wrong', message }: AdminErrorStateProps) {
  return (
    <div className="cc-state cc-state--error" role="alert">
      <span className="cc-state__icon">
        <AdminIcon name="alert" size={18} />
      </span>
      <p className="cc-state__title">{title}</p>
      <p className="cc-state__message">{message ?? 'The request could not be completed. Please try again.'}</p>
      <div className="cc-state__action">
        <DashboardRefreshButton />
      </div>
    </div>
  );
}
