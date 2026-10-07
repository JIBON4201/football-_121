import {
  CareerSkeleton,
  PlayerMatchSkeleton,
  PlayerNewsSkeleton,
  PlayerProfileSkeleton,
  PlayerStatisticsSkeleton,
} from '@/components/players/PlayerSkeletons';

export default function PlayerDetailLoading() {
  return (
    <div className="container">
      <PlayerProfileSkeleton />
      <PlayerStatisticsSkeleton />
      <PlayerMatchSkeleton count={3} />
      <CareerSkeleton count={3} />
      <PlayerNewsSkeleton />
    </div>
  );
}
