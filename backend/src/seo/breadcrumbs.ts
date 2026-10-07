import { config } from '../config';
import { absoluteCanonicalUrl, type CanonicalEntityType } from './canonical';

export interface BreadcrumbItem {
  name: string;
  url: string;
}

function home(): BreadcrumbItem {
  return { name: 'Home', url: `${config.site.baseUrl}/` };
}

/** Home → Competition → Team → Player/Match/News. All URLs canonical. */
export function breadcrumbsForCompetition(competitionName: string, competitionSlug: string): BreadcrumbItem[] {
  return [home(), { name: competitionName, url: absoluteCanonicalUrl('competition', competitionSlug) }];
}

export function breadcrumbsForTeam(
  teamName: string,
  teamSlug: string,
  competition?: { name: string; slug: string } | null,
): BreadcrumbItem[] {
  const trail: BreadcrumbItem[] = [home()];
  if (competition) trail.push({ name: competition.name, url: absoluteCanonicalUrl('competition', competition.slug) });
  trail.push({ name: teamName, url: absoluteCanonicalUrl('team', teamSlug) });
  return trail;
}

export function breadcrumbsForPlayer(
  playerName: string,
  playerSlug: string,
  team?: { name: string; slug: string } | null,
): BreadcrumbItem[] {
  const trail: BreadcrumbItem[] = [home()];
  if (team) trail.push({ name: team.name, url: absoluteCanonicalUrl('team', team.slug) });
  trail.push({ name: playerName, url: absoluteCanonicalUrl('player', playerSlug) });
  return trail;
}

export function breadcrumbsForMatch(
  matchLabel: string,
  matchSlug: string,
  competition?: { name: string; slug: string } | null,
): BreadcrumbItem[] {
  const trail: BreadcrumbItem[] = [home()];
  if (competition) trail.push({ name: competition.name, url: absoluteCanonicalUrl('competition', competition.slug) });
  trail.push({ name: matchLabel, url: absoluteCanonicalUrl('match', matchSlug) });
  return trail;
}

export function breadcrumbsForNews(
  title: string,
  slug: string,
  context?: { name: string; type: CanonicalEntityType; slug: string } | null,
): BreadcrumbItem[] {
  const trail: BreadcrumbItem[] = [home(), { name: 'News', url: `${config.site.baseUrl}/news` }];
  if (context) trail.push({ name: context.name, url: absoluteCanonicalUrl(context.type, context.slug) });
  trail.push({ name: title, url: absoluteCanonicalUrl('news', slug) });
  return trail;
}
