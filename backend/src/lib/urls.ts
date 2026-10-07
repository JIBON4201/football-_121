export const SEARCHABLE_ENTITY_TYPES = ['news', 'match', 'team', 'player', 'competition'] as const;

export type SearchableEntityType = (typeof SEARCHABLE_ENTITY_TYPES)[number];

/** Single source of truth for canonical frontend paths. */
const ENTITY_PATHS: Record<SearchableEntityType, string> = {
  news: '/news',
  match: '/matches',
  team: '/teams',
  player: '/players',
  competition: '/competitions',
};

export function canonicalUrl(entityType: SearchableEntityType, slug: string): string {
  return `${ENTITY_PATHS[entityType]}/${slug}`;
}
