import { sanitizeText } from '@/lib/validation';
import type { RelatedLink } from '@/lib/news';

const ENTITY_LABELS: Record<string, string> = {
  team: 'Teams',
  player: 'Players',
  competition: 'Competitions',
  match: 'Matches',
};

/**
 * Canonical entity chips for an article (teams/players/competitions/
 * matches). Links are backend-provided canonical URLs, validated before
 * render — unsafe targets are dropped, never rendered.
 */
export function EntityLinks({ entities }: { entities: RelatedLink[] }) {
  const safe = entities.filter((entity) => entity.url.startsWith('/'));
  if (safe.length === 0) return null;
  const groups = new Map<string, RelatedLink[]>();
  for (const entity of safe) {
    const list = groups.get(entity.entityType) ?? [];
    list.push(entity);
    groups.set(entity.entityType, list);
  }
  return (
    <section aria-label="Related football entities">
      <h2>Related</h2>
      {Array.from(groups.entries()).map(([kind, items]) => (
        <div key={kind}>
          <h3>{ENTITY_LABELS[kind] ?? kind}</h3>
          <ul className="entity-links">
            {items.map((entity) => (
              <li key={`${entity.entityType}-${entity.id}`}>
                <a href={entity.url}>{sanitizeText(entity.title)}</a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
