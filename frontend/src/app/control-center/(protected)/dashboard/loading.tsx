import { StatGridSkeleton, PanelSkeleton } from '@/components/admin/ui/Skeleton';

/**
 * Route-level loading boundary for the dashboard. Same density as the real
 * page (stat cards + five panels) so the state does not shift layout.
 */
export default function DashboardLoading() {
  return (
    <div className="cc-dashboard" aria-busy="true" aria-live="polite">
      <StatGridSkeleton count={10} />
      <div className="cc-panel-grid">
        <PanelSkeleton />
        <PanelSkeleton />
      </div>
      <span className="cc-visually-hidden">Loading dashboard</span>
    </div>
  );
}
