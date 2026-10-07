import {
  CompetitionHeaderSkeleton,
  MatchListSkeleton,
  NewsSkeleton,
  StandingsSkeleton,
  TeamListSkeleton,
} from '@/components/competitions/CompetitionSkeletons';

export default function CompetitionDetailLoading() {
  return (
    <div className="container">
      <CompetitionHeaderSkeleton />
      <StandingsSkeleton rows={8} />
      <MatchListSkeleton count={4} />
      <TeamListSkeleton count={6} />
      <NewsSkeleton count={3} />
    </div>
  );
}
