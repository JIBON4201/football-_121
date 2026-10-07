import { PanelSkeleton } from '@/components/admin/ui/Skeleton';

/** Shared loading boundary for the articles segment (list + new + edit). */
export default function ArticlesLoading() {
  return (
    <div className="cc-dashboard" aria-busy="true" aria-live="polite">
      <PanelSkeleton rows={8} />
      <span className="cc-visually-hidden">Loading articles</span>
    </div>
  );
}
