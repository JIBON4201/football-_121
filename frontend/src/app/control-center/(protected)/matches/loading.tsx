import { PanelSkeleton } from '@/components/admin/ui/Skeleton';

/** Shared loading boundary for the matches segment. */
export default function MatchesLoading() {
  return (
    <div className="cc-dashboard" aria-busy="true" aria-live="polite">
      <PanelSkeleton rows={8} />
      <span className="cc-visually-hidden">Loading matches</span>
    </div>
  );
}
