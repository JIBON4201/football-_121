import { upstream } from '../lib/errors';
import { serviceClient, type DbClient } from '../lib/supabase';
import { absoluteCanonicalUrl, type CanonicalEntityType } from './canonical';

export interface LinkTarget {
  entityType: CanonicalEntityType;
  id: string;
  slug: string;
  title: string;
  url: string;
}

const ARTICLE_RELATIONS: Array<{ table: string; column: string; kind: CanonicalEntityType; titleColumn: string }> = [
  { table: 'article_teams', column: 'team_id', kind: 'team', titleColumn: 'name' },
  { table: 'article_players', column: 'player_id', kind: 'player', titleColumn: 'display_name' },
  { table: 'article_competitions', column: 'competition_id', kind: 'competition', titleColumn: 'name' },
  { table: 'article_matches', column: 'match_id', kind: 'match', titleColumn: 'slug' },
];

const ENTITY_TABLE: Record<CanonicalEntityType, string> = {
  news: 'articles',
  match: 'matches',
  team: 'teams',
  player: 'players',
  competition: 'competitions',
  season: 'seasons',
  transfer: 'transfers',
};

async function publishedArticleIdsFor(
  client: DbClient,
  table: string,
  column: string,
  entityId: string,
  excludeArticleId: string,
  limit: number,
): Promise<string[]> {
  const { data, error } = await client
    .from(table)
    .select('article_id')
    .eq(column, entityId)
    .range(0, limit - 1);
  if (error) throw upstream('Failed to load related articles');
  const ids = (((data as Array<{ article_id: string }> | null) ?? []).map((r) => r.article_id)).filter(
    (id) => id && id !== excludeArticleId,
  );
  return [...new Set(ids)];
}

/**
 * Related published articles via shared football entities, scored by
 * overlap. Canonical targets only, self excluded, duplicates removed.
 */
export async function relatedArticles(
  articleId: string,
  limit = 5,
  client: DbClient = serviceClient(),
): Promise<LinkTarget[]> {
  const nowIso = new Date().toISOString();
  const scores = new Map<string, number>();
  for (const rel of ARTICLE_RELATIONS) {
    const { data } = await client.from(rel.table).select(rel.column).eq('article_id', articleId).range(0, 49);
    const entityIds = (((data as Array<Record<string, string>> | null) ?? []).map((r) => r[rel.column])).filter(Boolean);
    for (const entityId of entityIds.slice(0, 20)) {
      const others = await publishedArticleIdsFor(client, rel.table, rel.column, entityId, articleId, 20);
      for (const other of others) scores.set(other, (scores.get(other) ?? 0) + 1);
    }
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, limit * 2).map(([id]) => id);
  if (ranked.length === 0) return [];
  const { data, error } = await client
    .from('articles')
    .select('id,slug,title')
    .in('id', ranked)
    // `ranked` is already sliced to `limit * 2`; the bound is restated so the
    // guarantee is visible (and enforceable) at the query itself.
    .limit(ranked.length)
    .eq('status', 'published')
    .not('published_at', 'is', null)
    .lte('published_at', nowIso);
  if (error) throw upstream('Failed to load related articles');
  const rows = ((data as Array<{ id: string; slug: string; title: string }> | null) ?? []).slice(0, limit);
  const seen = new Set<string>();
  const out: LinkTarget[] = [];
  for (const row of rows) {
    const url = absoluteCanonicalUrl('news', row.slug);
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ entityType: 'news', id: row.id, slug: row.slug, title: row.title, url });
  }
  return out;
}

/** Canonical entity targets linked from an article (no cycles: never links self). */
export async function entityLinksForArticle(
  articleId: string,
  articleSlug: string,
  client: DbClient = serviceClient(),
): Promise<LinkTarget[]> {
  const out: LinkTarget[] = [];
  const seen = new Set<string>();
  for (const rel of ARTICLE_RELATIONS) {
    const { data } = await client.from(rel.table).select(rel.column).eq('article_id', articleId).range(0, 49);
    const entityIds = [...new Set((((data as Array<Record<string, string>> | null) ?? []).map((r) => r[rel.column])).filter(Boolean))].slice(0, 10);
    if (entityIds.length === 0) continue;
    const table = rel.kind === 'news' ? 'articles' : ENTITY_TABLE[rel.kind];
    const { data: entities } = await client.from(table).select('id,slug,name,display_name').in('id', entityIds).limit(entityIds.length);
    for (const row of ((entities as Array<{ id: string; slug?: string; name?: string; display_name?: string }> | null) ?? [])) {
      if (!row.slug) continue;
      const url = absoluteCanonicalUrl(rel.kind, row.slug);
      if (url.endsWith(`/news/${articleSlug}`) || seen.has(url)) continue;
      seen.add(url);
      out.push({ entityType: rel.kind, id: row.id, slug: row.slug, title: row.display_name ?? row.name ?? row.slug, url });
    }
  }
  return out.slice(0, 20);
}
