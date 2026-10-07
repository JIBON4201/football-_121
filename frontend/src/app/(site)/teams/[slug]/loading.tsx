import {
  SquadSkeleton,
  TeamCompetitionSkeleton,
  TeamFormSkeleton,
  TeamMatchSkeleton,
  TeamNewsSkeleton,
  TeamProfileSkeleton,
  TeamStatisticsSkeleton,
} from '@/components/teams/TeamSkeletons';

export default function TeamDetailLoading() {
  return (
    <div className="container">
      <TeamProfileSkeleton />
      <TeamFormSkeleton />
      <TeamMatchSkeleton count={2} />
      <TeamStatisticsSkeleton />
      <SquadSkeleton count={6} />
      <TeamCompetitionSkeleton />
      <TeamNewsSkeleton />
    </div>
  );
}
