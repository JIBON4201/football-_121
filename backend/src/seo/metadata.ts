import { config } from '../config';
import { log } from '../lib/logger';
import { absoluteCanonicalUrl, type CanonicalEntityType } from './canonical';

export interface RobotsDirectives {
  index: boolean;
  follow: boolean;
}

export interface SeoMetadata {
  title: string;
  description: string;
  canonical: string;
  robots: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string | null;
  ogType: 'article' | 'website' | 'profile';
  twitterCard: 'summary' | 'summary_large_image';
  twitterTitle: string;
  twitterDescription: string;
  twitterImage: string | null;
}

export interface EntitySnapshot {
  title?: string | null;
  excerpt?: string | null;
  slug?: string | null;
  name?: string | null;
  displayName?: string | null;
  shortName?: string | null;
  articleType?: string | null;
  status?: string | null;
  publishedAt?: string | null;
  scheduledAt?: string | null;
  homeName?: string | null;
  awayName?: string | null;
  competitionName?: string | null;
  scheduledAtMatch?: string | null;
  image?: string | null;
  isActive?: boolean | null;
}

export interface CustomSeoRow {
  meta_title?: string | null;
  meta_description?: string | null;
  canonical_url?: string | null;
  robots_index?: boolean | null;
  robots_follow?: boolean | null;
  og_title?: string | null;
  og_description?: string | null;
  og_image?: string | null;
  twitter_title?: string | null;
  twitter_description?: string | null;
  twitter_image?: string | null;
}

/** Strip tags, collapse whitespace, truncate without splitting words harshly. */
export function toPlainText(raw: string | null | undefined, maxLength: number): string {
  if (!raw) return '';
  const text = String(raw)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxLength * 0.5 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/** Escape for HTML meta attributes / XML text. */
export function escapeMeta(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function robotsString(directives: RobotsDirectives): string {
  return `${directives.index ? 'index' : 'noindex'},${directives.follow ? 'follow' : 'nofollow'}`;
}

/**
 * Centralized robots policy. Non-indexable states (draft/review/scheduled/
 * archived/cancelled/rumour/private) never become indexable.
 */
export function robotsFor(entityType: CanonicalEntityType | 'search' | 'admin' | 'internal', entity?: EntitySnapshot): RobotsDirectives {
  if (entityType === 'admin' || entityType === 'internal') return { index: false, follow: false };
  if (entityType === 'search') return { index: false, follow: true };
  const status = (entity?.status ?? '').toLowerCase();
  if (['draft', 'review', 'scheduled', 'archived'].includes(status)) return { index: false, follow: false };
  if (['cancelled', 'abandoned', 'suspended', 'rumour', 'rejected'].includes(status)) {
    return entityType === 'news' ? { index: false, follow: false } : { index: false, follow: true };
  }
  if (entity?.isActive === false) return { index: false, follow: true };
  if (entityType === 'news' && entity?.publishedAt) {
    if (Number.isNaN(Date.parse(entity.publishedAt))) return { index: false, follow: false };
    if (Date.parse(entity.publishedAt) > Date.now()) return { index: false, follow: false };
  }
  return { index: true, follow: true };
}

function entityDefaultTitle(entityType: CanonicalEntityType, entity: EntitySnapshot): string {
  const site = config.site.name;
  switch (entityType) {
    case 'news': {
      const base = entity.title || entity.excerpt || 'Football news';
      return `${base} | ${site}`;
    }
    case 'match': {
      if (entity.homeName && entity.awayName) {
        const comp = entity.competitionName ? ` - ${entity.competitionName}` : '';
        return `${entity.homeName} vs ${entity.awayName}${comp} | ${site}`;
      }
      return `Match | ${site}`;
    }
    case 'team':
      return `${entity.name ?? 'Team'} - Fixtures, Results & News | ${site}`;
    case 'player':
      return `${entity.displayName ?? entity.name ?? 'Player'} - Profile, Stats & News | ${site}`;
    case 'competition':
      return `${entity.name ?? 'Competition'} - Fixtures, Table & News | ${site}`;
    case 'season':
      return `${entity.name ?? 'Season'} | ${site}`;
    case 'transfer':
      return `${entity.title ?? entity.displayName ?? 'Transfer'} | ${site}`;
    default:
      return site;
  }
}

function entityDefaultDescription(entityType: CanonicalEntityType, entity: EntitySnapshot): string {
  switch (entityType) {
    case 'news':
      return toPlainText(entity.excerpt || '', 160) || config.site.defaultDescription;
    case 'match': {
      const when = entity.scheduledAtMatch ? ` Kick-off ${entity.scheduledAtMatch}.` : '';
      const comp = entity.competitionName ? ` ${entity.competitionName}.` : '';
      if (entity.homeName && entity.awayName) return `${entity.homeName} vs ${entity.awayName}.${comp}${when}`.trim();
      return config.site.defaultDescription;
    }
    case 'team':
      return entity.shortName ? `${entity.name} (${entity.shortName}) fixtures, results, squad and news.` : `${entity.name ?? 'Team'} fixtures, results, squad and news.`;
    case 'player':
      return `${entity.displayName ?? entity.name ?? 'Player'} profile, stats and latest news.`;
    case 'competition':
      return `${entity.name ?? 'Competition'} fixtures, results and news.`;
    case 'season':
      return `${entity.name ?? 'Season'} fixtures and standings.`;
    case 'transfer':
      return toPlainText(entity.excerpt || '', 160) || config.site.defaultDescription;
    default:
      return config.site.defaultDescription;
  }
}

/**
 * Metadata resolution: custom SEO → entity defaults → global defaults.
 * Never fabricates: missing content falls back to honest global defaults.
 */
export function resolveMetadata(
  entityType: CanonicalEntityType,
  slug: string,
  entity: EntitySnapshot,
  custom: CustomSeoRow | null,
  robots: RobotsDirectives,
): SeoMetadata {
  const canonical = absoluteCanonicalUrl(entityType, slug);
  const title = (custom?.meta_title?.trim() || entityDefaultTitle(entityType, entity)).slice(0, 200);
  const description = (custom?.meta_description?.trim() || entityDefaultDescription(entityType, entity)).slice(0, 500);
  if (!entity.title && !entity.name && !entity.displayName && !custom?.meta_title) {
    log({ msg: 'seo_metadata_fallback', entityType, slug });
  }
  const image = custom?.og_image?.trim() || entity.image?.trim() || config.site.defaultImage || null;
  const ogTitle = (custom?.og_title?.trim() || title).slice(0, 200);
  const ogDescription = (custom?.og_description?.trim() || description).slice(0, 500);
  const twitterTitle = (custom?.twitter_title?.trim() || ogTitle).slice(0, 200);
  const twitterDescription = (custom?.twitter_description?.trim() || ogDescription).slice(0, 500);
  const twitterImage = custom?.twitter_image?.trim() || image;
  return {
    title,
    description,
    canonical,
    robots: robotsString({
      index: custom?.robots_index ?? robots.index,
      follow: custom?.robots_follow ?? robots.follow,
    }),
    ogTitle,
    ogDescription,
    ogImage: image,
    ogType: entityType === 'news' ? 'article' : entityType === 'player' ? 'profile' : 'website',
    twitterCard: image ? 'summary_large_image' : 'summary',
    twitterTitle,
    twitterDescription,
    twitterImage,
  };
}
