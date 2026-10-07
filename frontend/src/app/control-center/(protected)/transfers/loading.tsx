import { PanelSkeleton } from '@/components/admin/ui/Skeleton';

/** Shared loading boundary for the transfers segment. */
export default function TransfersLoading() {
  return (
    <div className="cc-dashboard" aria-busy="true" aria-live="polite">
      <PanelSkeleton rows={8} />
      <span className="cc-visually-hidden">Loading transfers</span>
    </div>
  );
}
