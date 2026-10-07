import { ListingSkeleton } from '@/components/ui/Skeleton';

export default function BreakingNewsLoading() {
  return (
    <div className="container">
      <ListingSkeleton count={6} />
    </div>
  );
}
