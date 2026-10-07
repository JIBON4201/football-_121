import { ListingSkeleton } from '@/components/ui/Skeleton';

export default function TagLoading() {
  return (
    <div className="container">
      <ListingSkeleton count={6} />
    </div>
  );
}
