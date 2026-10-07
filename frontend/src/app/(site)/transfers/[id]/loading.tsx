import {
  TransferCardSkeleton,
  TransferDetailSkeleton,
  TransferFilterSkeleton,
  TransferNewsSkeleton,
} from '@/components/transfers/TransferSkeletons';

export default function TransferDetailLoading() {
  return (
    <div className="container">
      <TransferDetailSkeleton />
      <TransferFilterSkeleton />
      <TransferCardSkeleton count={2} />
      <TransferNewsSkeleton />
    </div>
  );
}
