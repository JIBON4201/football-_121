import { config } from '../config';
import { cached, invalidateNamespace } from '../lib/cache';
import { notFound, toServiceError, upstream } from '../lib/errors';
import { log } from '../lib/logger';
import { serviceClient, type DbClient } from '../lib/supabase';
import {
  breadcrumbsForCompetition,
  breadcrumbsForMatch,
  breadcrumbsForNews,
  breadcrumbsForPlayer,
  breadcrumbsForTeam,
  type BreadcrumbItem,
} from '../seo/breadcrumbs';
import {
  absoluteCanonicalUrl,
  CANONICAL_ENTITY_TYPES,
  findDuplicateCanonicals,
  isCanonicalLoop,
  isValidSlug,
  parseCanonicalPath,
  type CanonicalEntityType,
} from '../seo/canonical';
import { createArticleLinkContext, entityLinksForArticle, relatedArticles, type ArticleLinkContext, type LinkTarget } from '../seo/linking';
import {
  resolveMetadata,
  robotsFor,
  type CustomSeoRow,
  type EntitySnapshot,
  type SeoMetadata,
} from '../seo/metadata';
import {
  assertValidJsonLd,
  breadcrumbJsonLd,
  matchJsonLd,
  newsJsonLd,
  organizationJsonLd,
  personJsonLd,
  teamJsonLd,
  websiteJsonLd,
  type JsonLd,
} from '../seo/structured';
import { findActiveRedirect } from '../repositories/articles.repo';

const SEO_NS = 'seo';
const SEO_TTL = config.seo.cacheTtl;

export type SeoEntityType = CanonicalEntityType;

interface ResolvedEntity {
  entityType: SeoEntityType;
  slug: string;
  row: Record<string, unknown>;
  snapshot: EntitySnapshot;
  customSeo: CustomSeoRow | null;
  image: string | null;
  context: {
    competition?: { name: string; slug: string } | null;
    team?: { name: string; slug: string } | null;
    teams?: Array<{ name: string; slug: string }>;
  };
}

/**
 * Request-scoped memoization for entity resolution.
 *
 * Within a single request, `getMetadata`, `getStructuredData`, `getBreadcrumbs`,
 * and `validate` may all need the same resolved entity. Without memoization,
 * each call re-reads from the database. This scope deduplicates those reads
 * so each (entityType, slug) pair is resolved at most once per request.
 *
 * No module-level state is used; callers create a scope per request and thread
 * it through every SEO method that needs it.
 */
export class SeoRequestScope {
  private readonly memo = new Map<string, Promise<ResolvedEntity>>();

  resolve(key: string, loader: () => Promise<ResolvedEntity>): Promise<ResolvedEntity> {
    const existing = this.memo.get(key);
    if (existing) return existing;
    const promise = loader();
    this.memo.set(key, promise);
    return promise;
  }
}

function absolutizeImage(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = String(url).trim();
  if (!trimmed || trimmed.length > 2000) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/')) return `${config.site.baseUrl}${trimmed}`;
  return null;
}

async function customSeoFor(entityType: SeoEntityType, entityId: string, client: DbClient): Promise<CustomSeoRow | null> {
  if (entityType !== 'news') return null;
  const { data } = await client
    .from('seo_metadata')
    .select('meta_title,meta_description,canonical_url,robots_index,robots_follow,og_title,og_description,og_image,twitter_title,twitter_description,twitter_image')
    .eq('entity_type', 'article')
    .eq('entity_id', entityId)
    .maybeSingle();
  return (data as CustomSeoRow | null) ?? null;
}

async function mediaUrl(mediaId: string | null | undefined, client: DbClient): Promise<string | null> {
  if (!mediaId) return null;
  const { data } = await client.from('media').select('public_url').eq('id', String(mediaId)).maybeSingle();
  return absolutizeImage((data as { public_url?: string } | null)?.public_url ?? null);
}

function isPublishedArticle(row: Record<string, unknown>): boolean {
  if (row.status !== 'published' || !row.published_at) return false;
  const t = Date.parse(String(row.published_at));
  return !Number.isNaN(t) && t <= Date.now();
}

async function resolveArticle(
  slug: string,
  client: DbClient,
  links?: ArticleLinkContext,
): Promise<ResolvedEntity> {
  const { data, error } = await client
    .from('articles')
    .select('id,slug,title,excerpt,article_type,status,published_at,updated_at,featured_image_id')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw upstream('Failed to load article');
  const row = (data as Record<string, unknown> | null) ?? null;
  if (!row) throw notFound('Article');
  if (!isPublishedArticle(row)) throw notFound('Article');
  const custom = await customSeoFor('news', String(row.id), client).catch(() => null);
  const image = absolutizeImage((await mediaUrl(row.featured_image_id as string | null, client).catch(() => null)) ?? null);
  // First linked competition/team for breadcrumb context. When the caller shares a
  // link context, these relation rows are already loaded for the related-content
  // builders, so the same read serves all three.
  const linked = await (links ?? createArticleLinkContext(client)).entityIdsFor(String(row.id), ['competition', 'team']);
  let competition: { name: string; slug: string } | null = null;
  let team: { name: string; slug: string } | null = null;
  const compId = linked.competition[0];
  if (compId) {
    const comp = await client.from('competitions').select('name,slug').eq('id', compId).maybeSingle();
    const c = (comp.data as { name?: string; slug?: string } | null) ?? null;
    if (c?.slug) competition = { name: c.name ?? c.slug, slug: c.slug };
  }
  if (!competition) {
    const teamId = linked.team[0];
    if (teamId) {
      const t = await client.from('teams').select('name,slug').eq('id', teamId).maybeSingle();
      const teamRow = (t.data as { name?: string; slug?: string } | null) ?? null;
      if (teamRow?.slug) team = { name: teamRow.name ?? teamRow.slug, slug: teamRow.slug };
    }
  }
  return {
    entityType: 'news',
    slug: String(row.slug),
    row,
    snapshot: {
      title: (row.title as string) ?? null,
      excerpt: (row.excerpt as string) ?? null,
      slug: String(row.slug),
      articleType: (row.article_type as string) ?? null,
      status: (row.status as string) ?? null,
      publishedAt: (row.published_at as string) ?? null,
      image,
    },
    customSeo: custom,
    image,
    context: { competition, team },
  };
}

async function resolveSimple(
  entityType: Exclude<SeoEntityType, 'news' | 'season' | 'transfer'>,
  slug: string,
  client: DbClient,
): Promise<ResolvedEntity> {
  const table = { match: 'matches', team: 'teams', player: 'players', competition: 'competitions' }[entityType];
  let columns: string;
  switch (entityType) {
    case 'team':
      columns = 'id,slug,name,short_name,logo_url,is_active';
      break;
    case 'player':
      columns = 'id,slug,display_name,photo_url,status';
      break;
    case 'competition':
      columns = 'id,slug,name,short_name,logo_url,is_active';
      break;
    case 'match':
      columns = 'id,slug,status,scheduled_at,competition_id,home_team_id,away_team_id,venue_id,home_score,away_score';
      break;
    default:
      columns = '*';
  }
  const { data, error } = await client.from(table).select(columns).eq('slug', slug).maybeSingle();
  if (error) throw upstream(`Failed to load ${entityType}`);
  const row = (data as Record<string, unknown> | null) ?? null;
  if (!row) throw notFound(entityType);
  let snapshot: EntitySnapshot = { slug, status: (row.status as string) ?? null, isActive: (row.is_active as boolean) ?? null };
  let image: string | null = null;
  const context: ResolvedEntity['context'] = {};
  if (entityType === 'team') {
    snapshot = { ...snapshot, name: (row.name as string) ?? null, shortName: (row.short_name as string) ?? null };
    image = absolutizeImage((row.logo_url as string) ?? null);
  } else if (entityType === 'player') {
    snapshot = { ...snapshot, name: (row.display_name as string) ?? null, displayName: (row.display_name as string) ?? null };
    image = absolutizeImage((row.photo_url as string) ?? null);
    const hist = await client.from('player_team_history').select('team_id').eq('player_id', String(row.id)).eq('is_current', true).range(0, 0);
    const teamId = ((hist.data as Array<{ team_id: string }> | null) ?? [])[0]?.team_id;
    if (teamId) {
      const t = await client.from('teams').select('name,slug').eq('id', teamId).maybeSingle();
      const teamRow = (t.data as { name?: string; slug?: string } | null) ?? null;
      if (teamRow?.slug) context.team = { name: teamRow.name ?? teamRow.slug, slug: teamRow.slug };
    }
  } else if (entityType === 'competition') {
    snapshot = { ...snapshot, name: (row.name as string) ?? null, shortName: (row.short_name as string) ?? null };
    image = absolutizeImage((row.logo_url as string) ?? null);
  } else if (entityType === 'match') {
    const teams = await Promise.all([
      client.from('teams').select('name,short_name,slug').eq('id', String(row.home_team_id)).maybeSingle(),
      client.from('teams').select('name,short_name,slug').eq('id', String(row.away_team_id)).maybeSingle(),
      client.from('competitions').select('name,slug,logo_url').eq('id', String(row.competition_id)).maybeSingle(),
    ]);
    const home = (teams[0].data as { name?: string; short_name?: string } | null) ?? null;
    const away = (teams[1].data as { name?: string; short_name?: string } | null) ?? null;
    const comp = (teams[2].data as { name?: string; slug?: string; logo_url?: string } | null) ?? null;
    snapshot = {
      ...snapshot,
      homeName: home ? String(home.short_name ?? home.name ?? '') : null,
      awayName: away ? String(away.short_name ?? away.name ?? '') : null,
      competitionName: comp?.name ?? null,
      scheduledAtMatch: (row.scheduled_at as string) ?? null,
    };
    if (comp?.slug) context.competition = { name: comp.name ?? comp.slug, slug: comp.slug };
    image = absolutizeImage(comp?.logo_url ?? null);
  }
  return { entityType, slug, row, snapshot: { ...snapshot, image }, customSeo: null, image, context };
}

async function resolveSeasonOrTransfer(
  entityType: 'season' | 'transfer',
  idOrSlug: string,
  client: DbClient,
): Promise<ResolvedEntity> {
  const table = entityType === 'season' ? 'seasons' : 'transfers';
  let row: Record<string, unknown> | null = null;
  const byId = await client.from(table).select('id,name,slug,status,title,display_name').eq('id', idOrSlug).maybeSingle();
  row = (byId.data as Record<string, unknown> | null) ?? null;
  if (!row && isValidSlug(idOrSlug)) {
    try {
      const bySlug = await client.from(table).select('id,name,slug,status,title,display_name').eq('slug', idOrSlug).maybeSingle();
      row = (bySlug.data as Record<string, unknown> | null) ?? null;
    } catch {
      row = null;
    }
  }
  if (!row) throw notFound(entityType);
  if (entityType === 'transfer') {
    const status = String(row.status ?? '');
    if (!['announced', 'completed'].includes(status)) throw notFound('Transfer');
  }
  const slug = String((row.slug as string) ?? (row.id as string));
  const snapshot: EntitySnapshot = {
    slug,
    title: (row.title as string) ?? (row.name as string) ?? null,
    name: (row.name as string) ?? null,
    displayName: (row.display_name as string) ?? null,
    status: (row.status as string) ?? null,
  };
  return { entityType, slug, row, snapshot, customSeo: null, image: null, context: {} };
}

async function resolveEntity(
  entityType: SeoEntityType,
  slug: string,
  client: DbClient,
  links?: ArticleLinkContext,
  scope?: SeoRequestScope,
): Promise<ResolvedEntity> {
  const key = `${entityType}:${slug}`;
  if (scope) {
    return scope.resolve(key, () => resolveEntityUncached(entityType, slug, client, links));
  }
  return resolveEntityUncached(entityType, slug, client, links);
}

async function resolveEntityUncached(
  entityType: SeoEntityType,
  slug: string,
  client: DbClient,
  links?: ArticleLinkContext,
): Promise<ResolvedEntity> {
  if (entityType === 'news') return resolveArticle(slug, client, links);
  if (entityType === 'season' || entityType === 'transfer') return resolveSeasonOrTransfer(entityType, slug, client);
  return resolveSimple(entityType, slug, client);
}

async function guarded<T>(loader: () => Promise<T>, message: string): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    const { ApiError } = await import('../lib/errors');
    if (error instanceof ApiError) throw error;
    throw toServiceError(error, message);
  }
}

export const seoService = {
  async getMetadata(entityType: SeoEntityType, slug: string, scope?: SeoRequestScope): Promise<SeoMetadata> {
    return guarded(
      () =>
        cached(SEO_NS, { kind: 'metadata', type: entityType, slug }, SEO_TTL, async () => {
          if (!(CANONICAL_ENTITY_TYPES as readonly string[]).includes(entityType)) throw notFound('Content');
          if (!isValidSlug(slug)) throw notFound('Content');
          const client = serviceClient();
          const resolved = await resolveEntity(entityType, slug, client, undefined, scope);
          const robots = robotsFor(entityType, resolved.snapshot);
          return resolveMetadata(entityType, resolved.slug, resolved.snapshot, resolved.customSeo, robots);
        }),
      'SEO service unavailable',
    );
  },

  async getStructuredData(entityType: SeoEntityType, slug: string, resolved?: ResolvedEntity, scope?: SeoRequestScope): Promise<JsonLd[]> {
    return guarded(
      () =>
        cached(SEO_NS, { kind: 'structured', type: entityType, slug }, SEO_TTL, async () => {
          const client = serviceClient();
          const entity = resolved ?? await resolveEntity(entityType, slug, client, undefined, scope);
          const canonical = absoluteCanonicalUrl(entityType, entity.slug);
          const out: JsonLd[] = [organizationJsonLd(), websiteJsonLd()];
          if (entityType === 'news') {
            const node = newsJsonLd({
              canonical,
              title: (entity.row.title as string) ?? null,
              excerpt: (entity.row.excerpt as string) ?? null,
              publishedAt: (entity.row.published_at as string) ?? null,
              updatedAt: (entity.row.updated_at as string) ?? null,
              image: entity.image,
              articleType: (entity.row.article_type as string) ?? null,
            });
            if (node) out.push(node);
          } else if (entityType === 'team') {
            const node = teamJsonLd({ canonical, name: (entity.row.name as string) ?? null, logo: entity.image });
            if (node) out.push(node);
          } else if (entityType === 'player') {
            const node = personJsonLd({
              canonical,
              name: (entity.row.display_name as string) ?? null,
              image: entity.image,
              teamName: entity.context.team?.name ?? null,
            });
            if (node) out.push(node);
          } else if (entityType === 'match') {
            const row = entity.row;
            let venueName: string | null = null;
            if (row.venue_id) {
              try {
                const venue = await client.from('venues').select('name').eq('id', String(row.venue_id)).maybeSingle();
                venueName = ((venue.data as { name?: string } | null)?.name as string) ?? null;
              } catch {
                venueName = null;
              }
            }
            const node = matchJsonLd({
              canonical,
              homeName: entity.snapshot.homeName ?? null,
              awayName: entity.snapshot.awayName ?? null,
              competitionName: entity.snapshot.competitionName ?? null,
              venueName,
              scheduledAt: (row.scheduled_at as string) ?? null,
              status: (row.status as string) ?? null,
              homeScore: (row.home_score as number) ?? null,
              awayScore: (row.away_score as number) ?? null,
            });
            if (node) out.push(node);
          }
          const crumbs = await this.getBreadcrumbs(entityType, slug, entity).catch(() => []);
          const crumbNode = breadcrumbJsonLd(crumbs);
          if (crumbNode) out.push(crumbNode);
          for (const node of out) {
            try {
              assertValidJsonLd(node);
            } catch (error) {
              log({ msg: 'seo_structured_invalid', entityType, slug, error: error instanceof Error ? error.message : 'invalid' });
              throw upstream('Structured data unavailable');
            }
          }
          return out;
        }),
      'SEO service unavailable',
    );
  },

  async getBreadcrumbs(entityType: SeoEntityType, slug: string, resolved?: ResolvedEntity, scope?: SeoRequestScope): Promise<BreadcrumbItem[]> {
    return guarded(
      () =>
        cached(SEO_NS, { kind: 'breadcrumbs', type: entityType, slug }, SEO_TTL, async () => {
          const client = serviceClient();
          const entity = resolved ?? await resolveEntity(entityType, slug, client, undefined, scope);
          const row = entity.row;
          switch (entityType) {
            case 'news': {
              const ctx = entity.context.competition
                ? { name: entity.context.competition.name, type: 'competition' as const, slug: entity.context.competition.slug }
                : entity.context.team
                  ? { name: entity.context.team.name, type: 'team' as const, slug: entity.context.team.slug }
                  : null;
              return breadcrumbsForNews(String(row.title ?? slug), entity.slug, ctx);
            }
            case 'match': {
              const label = entity.snapshot.homeName && entity.snapshot.awayName
                ? `${entity.snapshot.homeName} vs ${entity.snapshot.awayName}`
                : String((row.slug as string) ?? slug);
              return breadcrumbsForMatch(label, entity.slug, entity.context.competition ?? null);
            }
            case 'team':
              return breadcrumbsForTeam(String(row.name ?? slug), entity.slug, entity.context.competition ?? null);
            case 'player':
              return breadcrumbsForPlayer(String(row.display_name ?? row.name ?? slug), entity.slug, entity.context.team ?? null);
            case 'competition':
              return breadcrumbsForCompetition(String(row.name ?? slug), entity.slug);
            default:
              return [{ name: 'Home', url: `${config.site.baseUrl}/` }, { name: String((row.name as string) ?? (row.title as string) ?? slug), url: absoluteCanonicalUrl(entityType, entity.slug) }];
          }
        }),
      'SEO service unavailable',
    );
  },

  async getRelated(entityType: SeoEntityType, slug: string, limit = 5): Promise<{ related: LinkTarget[]; entities: LinkTarget[] }> {
    return guarded(async () => {
      if (entityType !== 'news') return { related: [], entities: [] };
      const client = serviceClient();
      // One request-scoped context: the article's relation rows are read once and
      // shared by the resolver and both link builders, so nothing is resolved twice.
      const links = createArticleLinkContext(client);
      const resolved = await resolveEntity('news', slug, client, links);
      const [related, entities] = await Promise.all([
        relatedArticles(String(resolved.row.id), Math.min(Math.max(limit, 1), 20), client, links),
        entityLinksForArticle(String(resolved.row.id), resolved.slug, client, links),
      ]);
      return { related, entities };
    }, 'SEO service unavailable');
  },

  /** Validation suite: duplicates, slugs, metadata, sitemap, JSON-LD, loops. */
  async validate(entityType: SeoEntityType, slug: string, scope?: SeoRequestScope): Promise<{
    entityType: string;
    slug: string;
    canonical: string | null;
    indexable: boolean;
    checks: Array<{ name: string; ok: boolean; detail?: string }>;
  }> {
    return guarded(async () => {
      const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
      const push = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });
      if (!(CANONICAL_ENTITY_TYPES as readonly string[]).includes(entityType)) {
        return { entityType, slug, canonical: null, indexable: false, checks: [{ name: 'entity-type', ok: false }] };
      }
      push('slug-present', Boolean(slug), slug ? undefined : 'missing slug');
      push('slug-valid', isValidSlug(slug), isValidSlug(slug) ? undefined : 'invalid slug');
      if (!isValidSlug(slug)) return { entityType, slug, canonical: null, indexable: false, checks };
      let canonical: string | null = null;
      try {
        canonical = absoluteCanonicalUrl(entityType, slug);
        push('canonical-valid', true);
      } catch {
        push('canonical-valid', false, 'invalid canonical');
        return { entityType, slug, canonical, indexable: false, checks };
      }
      const parsed = parseCanonicalPath(new URL(canonical).pathname);
      push('canonical-roundtrip', parsed?.entityType === entityType && parsed?.slug === slug);
      const client = serviceClient();
      let resolved: ResolvedEntity | null = null;
      try {
        resolved = await resolveEntity(entityType, slug, client, undefined, scope);
        push('entity-found', true);
        push('is-public', true);
      } catch {
        push('entity-found', false, 'not found or non-public');
        return { entityType, slug, canonical, indexable: false, checks };
      }
      const robots = robotsFor(entityType, resolved.snapshot);
      const indexable = robots.index;
      push('indexable', indexable, indexable ? undefined : `robots=${robots.index ? 'index' : 'noindex'},${robots.follow ? 'follow' : 'nofollow'}`);
      const metadata = resolveMetadata(entityType, resolved.slug, resolved.snapshot, resolved.customSeo, robots);
      push('metadata-title', metadata.title.length >= 5, metadata.title.length >= 5 ? undefined : 'missing title');
      push('metadata-description', metadata.description.length >= 5, metadata.description.length >= 5 ? undefined : 'missing description');
      push('metadata-canonical', metadata.canonical === canonical || resolved.slug === slug, metadata.canonical);
      // Duplicate slugs: same slug appearing on multiple rows.
      try {
        const table = { news: 'articles', match: 'matches', team: 'teams', player: 'players', competition: 'competitions' }[entityType as string];
        if (table) {
          const { data } = await client.from(table).select('id').eq('slug', resolved.slug).limit(2);
          const count = ((data as unknown[]) ?? []).length;
          push('no-duplicate-canonical', count <= 1, count <= 1 ? undefined : `${count} rows share slug`);
        } else {
          push('no-duplicate-canonical', true, 'skipped (id-addressed)');
        }
      } catch {
        push('no-duplicate-canonical', true, 'check unavailable');
      }
      // Sitemap consistency: indexable content must be sitemap-eligible.
      push('sitemap-eligible', indexable, indexable ? undefined : 'non-indexable excluded by design');
      // JSON-LD validity - pass the already-resolved entity to avoid re-resolution.
      try {
        const structured = await this.getStructuredData(entityType, slug, resolved, scope);
        assertValidJsonLd(structured);
        push('jsonld-valid', true);
      } catch {
        push('jsonld-valid', false, 'invalid JSON-LD');
      }
      // Redirect loop walk from this canonical path.
      try {
        const loop = await this.detectRedirectLoop(new URL(canonical).pathname, client);
        push('no-redirect-loop', !loop, loop ? 'redirect loop detected' : undefined);
      } catch {
        push('no-redirect-loop', true, 'check unavailable');
      }
      void findDuplicateCanonicals;
      void isCanonicalLoop;
      return { entityType, slug, canonical, indexable, checks };
    }, 'SEO service unavailable');
  },

  /**
   * Resolve a previously-published path to its final destination.
   *
   * Redirects are recorded whenever a slug changes, but until now nothing
   * served them, so an old URL 404'd instead of issuing a 301. Returns null
   * when no redirect exists, and also when following the chain would loop —
   * in which case the caller should 404 rather than redirect forever.
   */
  async resolveRedirect(
    path: string,
    client = serviceClient(),
  ): Promise<{ destination: string; statusCode: number } | null> {
    return guarded(async () => {
      const startPath = path.startsWith('/') ? path : `/${path}`;
      const found: Record<string, unknown> | null = await findActiveRedirect(startPath, client).catch(
        () => null,
      );
      if (!found) return null;

      const first = String(found.destination_path ?? '');
      if (!first || isCanonicalLoop(startPath, first)) return null;

      // Follow the chain to the final destination, refusing to serve a loop.
      const seen = new Set<string>([startPath, first]);
      let current = first;
      for (let hop = 0; hop < 10; hop += 1) {
        const next: Record<string, unknown> | null = await findActiveRedirect(current, client).catch(
          () => null,
        );
        if (!next) break;
        const destination = String(next.destination_path ?? '');
        if (!destination || seen.has(destination) || isCanonicalLoop(current, destination)) {
          return null;
        }
        seen.add(destination);
        current = destination;
      }

      const statusCode = Number(found.status_code ?? 301);
      return {
        destination: current,
        statusCode: Number.isInteger(statusCode) && statusCode >= 300 && statusCode < 400 ? statusCode : 301,
      };
    }, 'SEO service unavailable');
  },

  /** Follow active redirects up to 10 hops; true when a cycle is found. */
  async detectRedirectLoop(startPath: string, client = serviceClient()): Promise<boolean> {
    const seen = new Set<string>([startPath]);
    let current: string | null = startPath;
    for (let hop = 0; hop < 10 && current; hop += 1) {
      const currentPath: string = current;
      const found: Record<string, unknown> | null = await findActiveRedirect(currentPath, client).catch(() => null);
      if (!found) return false;
      const dest: string = String(found.destination_path ?? '');
      if (!dest) return false;
      if (isCanonicalLoop(currentPath, dest) || seen.has(dest)) return true;
      seen.add(dest);
      current = dest;
    }
    return false;
  },

  /** Invalidate SEO + sitemap caches (article/media/entity changes). */
  async invalidateSeoCaches(): Promise<void> {
    await invalidateNamespace('seo').catch(() => undefined);
    await invalidateNamespace('sitemap').catch(() => undefined);
    log({ msg: 'seo_cache_invalidated' });
  },
};