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

const ARTICLE_RELATIONS: Array<{ table: string; column: string; kind: ArticleRelationKind; titleColumn: string }> = [
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

/** Relation kinds an article can be linked through. */
type ArticleRelationKind = 'team' | 'player' | 'competition' | 'match';

/** Raw, ordered entity ids per relation table, exactly as stored (duplicates kept). */
type ArticleEntityIds = Record<ArticleRelationKind, string[]>;

/** One relation row as it comes back from the grouped query. */
type RelationRow = Record<string, string>;

/** Rows read for one article's own links (was `.range(0, 49)` on every read). */
const MAX_ARTICLE_LINK_ROWS = 50;
/** Entities per relation table scored for related articles. */
const MAX_SCORED_ENTITIES = 20;
/** Sibling articles read per scored entity. */
const MAX_SIBLINGS_PER_ENTITY = 20;
/** Entities per relation table published as canonical links. */
const MAX_ENTITY_LINKS = 10;
/** Canonical entity links returned in total. */
const MAX_ENTITY_LINKS_TOTAL = 20;

/**
 * Request-scoped cache of the relation rows for one article.
 *
 * `/seo/related` needs the same "which entities is this article linked to" rows
 * in three places: the article resolver (first competition/team for breadcrumb
 * context), the related-article scorer and the canonical entity-link builder. They
 * used to issue their own reads for the same rows. One context per request reads
 * each relation table once and hands the same promise to every caller.
 *
 * The context is created per request and holds no module-level state, so nothing
 * survives the request that made it.
 */
export interface ArticleLinkContext {
  /**
   * Entity ids linked to `articleId`, per relation table. Tables already read for
   * this article are reused; unread ones are fetched together. Passing `kinds`
   * loads only those tables, so a caller that needs one relation pays for one
   * read. Tables that were never read are returned as empty.
   */
  entityIdsFor(articleId: string, kinds?: readonly ArticleRelationKind[]): Promise<ArticleEntityIds>;
}

async function loadRelationIds(
  client: DbClient,
  rel: { table: string; column: string },
  articleId: string,
): Promise<string[]> {
  try {
    // Only the entity column is needed here, never `*`.
    const { data } = await client
      .from(rel.table)
      .select(rel.column)
      .eq('article_id', articleId)
      .range(0, MAX_ARTICLE_LINK_ROWS - 1);
    return ((data as Array<Record<string, string>> | null) ?? [])
      .map((row) => row[rel.column])
      .filter(Boolean);
  } catch {
    // Relation rows are advisory: a failing table yields no links rather than a
    // failed request, exactly as before.
    return [];
  }
}

export function createArticleLinkContext(client: DbClient): ArticleLinkContext {
  const perTable = new Map<string, Promise<string[]>>();
  const idsForTable = (articleId: string, rel: (typeof ARTICLE_RELATIONS)[number]): Promise<string[]> => {
    const key = `${articleId} ${rel.kind}`;
    let pending = perTable.get(key);
    if (!pending) {
      pending = loadRelationIds(client, rel, articleId);
      perTable.set(key, pending);
    }
    return pending;
  };

  return {
    async entityIdsFor(articleId: string, kinds?: readonly ArticleRelationKind[]): Promise<ArticleEntityIds> {
      const wanted = ARTICLE_RELATIONS.filter((rel) => !kinds || kinds.includes(rel.kind));
      const loaded = await Promise.all(wanted.map(async (rel) => [rel.kind, await idsForTable(articleId, rel)] as const));
      // Tables the caller did not ask for are empty rather than absent, so the
      // result always reads as a complete record.
      return { team: [], player: [], competition: [], match: [], ...Object.fromEntries(loaded) } as ArticleEntityIds;
    },
  };
}

/**
 * Every other article linked to any of `entityIds`, in one grouped query.
 *
 * Replaces one query per linked entity. The row budget is deliberately identical
 * to the loop it replaces (`entityIds.length * perEntity` rows), and the per-entity
 * ceiling is then applied in memory, so the same number of rows comes back — in
 * one round trip instead of up to twenty.
 */
async function siblingArticleIds(
  client: DbClient,
  rel: { table: string; column: string },
  entityIds: string[],
  excludeArticleId: string,
  perEntity: number,
): Promise<Map<string, string[]>> {
  const { data, error } = await client
    .from(rel.table)
    .select(`${rel.column},article_id` as string)
    .in(rel.column, entityIds)
    .order(rel.column, { ascending: true })
    .order('article_id', { ascending: true })
    .limit(entityIds.length * perEntity);
  if (error) throw upstream('Failed to load related articles');

  const consumed = new Map<string, number>();
  const grouped = new Map<string, string[]>();
  const rows = ((data as unknown as RelationRow[] | null) ?? []);
  for (const row of rows) {
    const entityId = row[rel.column];
    if (!entityId) continue;
    // Mirror the previous per-entity `range()`: only the first `perEntity` rows of
    // an entity were ever read, self-links and duplicates removed afterwards.
    const used = consumed.get(entityId) ?? 0;
    if (used >= perEntity) continue;
    consumed.set(entityId, used + 1);
    const bucket = grouped.get(entityId) ?? [];
    const articleId = row.article_id;
    if (articleId && articleId !== excludeArticleId && !bucket.includes(articleId)) bucket.push(articleId);
    grouped.set(entityId, bucket);
  }
  return grouped;
}

/**
 * Related published articles via shared football entities, scored by
 * overlap. Canonical targets only, self excluded, duplicates removed.
 */
export async function relatedArticles(
  articleId: string,
  limit = 5,
  client: DbClient = serviceClient(),
  context: ArticleLinkContext = createArticleLinkContext(client),
): Promise<LinkTarget[]> {
  const nowIso = new Date().toISOString();
  const linked = await context.entityIdsFor(articleId);
  // One grouped query per relation table rather than one per linked entity.
  const scored = await Promise.all(
    ARTICLE_RELATIONS.map(async (rel): Promise<Array<[string, number]>> => {
      const entityIds = linked[rel.kind].slice(0, MAX_SCORED_ENTITIES);
      if (entityIds.length === 0) return [];
      // A relation row stored twice for one entity still counted twice before;
      // the weight keeps that scoring identical.
      const weights = new Map<string, number>();
      for (const id of entityIds) weights.set(id, (weights.get(id) ?? 0) + 1);
      const siblings = await siblingArticleIds(client, rel, [...new Set(entityIds)], articleId, MAX_SIBLINGS_PER_ENTITY);
      const batch: Array<[string, number]> = [];
      for (const [entityId, articleIds] of siblings) {
        const weight = weights.get(entityId) ?? 1;
        for (const other of articleIds) batch.push([other, weight]);
      }
      return batch;
    }),
  );

  const scores = new Map<string, number>();
  for (const batch of scored) {
    for (const [other, weight] of batch) scores.set(other, (scores.get(other) ?? 0) + weight);
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
  context: ArticleLinkContext = createArticleLinkContext(client),
): Promise<LinkTarget[]> {
  const linked = await context.entityIdsFor(articleId);
  const targets = ARTICLE_RELATIONS.map((rel) => ({
    rel,
    entityIds: [...new Set(linked[rel.kind])].slice(0, MAX_ENTITY_LINKS),
  })).filter((entry) => entry.entityIds.length > 0);
  if (targets.length === 0) return [];

  // Entity rows are independent reads, so they go out together; the results are
  // still assembled in relation order below, which is what fixes link ordering.
  const resolved = await Promise.all(
    targets.map(async ({ rel, entityIds }) => {
      const { data: entities } = await client
        .from(ENTITY_TABLE[rel.kind])
        .select('id,slug,name,display_name')
        .in('id', entityIds)
        .limit(entityIds.length);
      return {
        rel,
        entities: (entities as Array<{ id: string; slug?: string; name?: string; display_name?: string }> | null) ?? [],
      };
    }),
  );

  const out: LinkTarget[] = [];
  const seen = new Set<string>();
  for (const { rel, entities } of resolved) {
    for (const row of entities) {
      if (!row.slug) continue;
      const url = absoluteCanonicalUrl(rel.kind, row.slug);
      if (url.endsWith(`/news/${articleSlug}`) || seen.has(url)) continue;
      seen.add(url);
      out.push({ entityType: rel.kind, id: row.id, slug: row.slug, title: row.display_name ?? row.name ?? row.slug, url });
    }
  }
  return out.slice(0, MAX_ENTITY_LINKS_TOTAL);
}
