import { config } from '../config';
import { log } from '../lib/logger';
import type { EntitySnapshot } from './metadata';

export type JsonLd = Record<string, unknown>;

function eventStatusFor(matchStatus: string | null | undefined): string | undefined {
  switch ((matchStatus ?? '').toLowerCase()) {
    case 'scheduled':
    case 'pre_match':
      return 'https://schema.org/EventScheduled';
    case 'live':
    case 'half_time':
    case 'extra_time':
    case 'penalty_shootout':
      return 'https://schema.org/EventLive';
    case 'finished':
      return 'https://schema.org/EventHappened';
    case 'postponed':
      return 'https://schema.org/EventPostponed';
    case 'cancelled':
    case 'abandoned':
      return 'https://schema.org/EventCancelled';
    default:
      return undefined;
  }
}

/** Serialize JSON-LD safely for inline <script> embedding. */
export function serializeJsonLd(value: JsonLd | JsonLd[]): string {
  return JSON.stringify(value).replace(/<\//g, '<\\/').replace(/<!--/g, '<\\!--');
}

/** Validate JSON-LD round-trips and carries @context/@type. Throws on invalid. */
export function assertValidJsonLd(value: JsonLd | JsonLd[]): void {
  const list = Array.isArray(value) ? value : [value];
  if (list.length === 0) throw new Error('Empty JSON-LD');
  for (const node of list) {
    if (!node || typeof node !== 'object') throw new Error('Invalid JSON-LD node');
    if ((node as Record<string, unknown>)['@context'] !== 'https://schema.org') {
      throw new Error('JSON-LD missing @context');
    }
    if (!(node as Record<string, unknown>)['@type']) throw new Error('JSON-LD missing @type');
  }
  JSON.parse(JSON.stringify(value));
}

export function organizationJsonLd(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: config.site.name,
    url: config.site.baseUrl,
  };
}

export function websiteJsonLd(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: config.site.name,
    url: config.site.baseUrl,
    inLanguage: config.site.language,
  };
}

export function breadcrumbJsonLd(items: Array<{ name: string; url: string }>): JsonLd | null {
  if (items.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function newsJsonLd(input: {
  canonical: string;
  title: string | null;
  excerpt?: string | null;
  publishedAt: string | null;
  updatedAt?: string | null;
  image?: string | null;
  articleType?: string | null;
}): JsonLd | null {
  if (!input.title || !input.publishedAt || Number.isNaN(Date.parse(input.publishedAt))) {
    log({ msg: 'seo_structured_skipped', schema: 'NewsArticle', reason: 'missing headline/datePublished' });
    return null;
  }
  const isNews = (input.articleType ?? 'news') === 'news' || (input.articleType ?? '') === 'breaking_news' || (input.articleType ?? '') === 'transfer';
  return {
    '@context': 'https://schema.org',
    '@type': isNews ? 'NewsArticle' : 'Article',
    headline: input.title,
    description: input.excerpt ?? undefined,
    url: input.canonical,
    datePublished: input.publishedAt,
    ...(input.updatedAt ? { dateModified: input.updatedAt } : {}),
    ...(input.image ? { image: [input.image] } : {}),
    author: { '@type': 'Organization', name: config.site.name, url: config.site.baseUrl },
    publisher: { '@type': 'Organization', name: config.site.name, url: config.site.baseUrl },
    inLanguage: config.site.language,
  };
}

export function teamJsonLd(input: { canonical: string; name: string | null; logo?: string | null }): JsonLd | null {
  if (!input.name) {
    log({ msg: 'seo_structured_skipped', schema: 'SportsTeam', reason: 'missing name' });
    return null;
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'SportsTeam',
    name: input.name,
    url: input.canonical,
    ...(input.logo ? { logo: input.logo } : {}),
    sport: 'Soccer',
  };
}

export function personJsonLd(input: { canonical: string; name: string | null; image?: string | null; teamName?: string | null }): JsonLd | null {
  if (!input.name) {
    log({ msg: 'seo_structured_skipped', schema: 'Person', reason: 'missing name' });
    return null;
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: input.name,
    url: input.canonical,
    ...(input.image ? { image: input.image } : {}),
    ...(input.teamName ? { memberOf: { '@type': 'SportsTeam', name: input.teamName } } : {}),
  };
}

export function matchJsonLd(input: {
  canonical: string;
  homeName: string | null;
  awayName: string | null;
  competitionName?: string | null;
  venueName?: string | null;
  scheduledAt: string | null;
  status?: string | null;
  homeScore?: number | null;
  awayScore?: number | null;
}): JsonLd | null {
  if (!input.homeName || !input.awayName || !input.scheduledAt || Number.isNaN(Date.parse(input.scheduledAt))) {
    log({ msg: 'seo_structured_skipped', schema: 'SportsEvent', reason: 'missing teams/startDate' });
    return null;
  }
  const eventStatus = eventStatusFor(input.status);
  const scoreKnown = input.homeScore !== null && input.homeScore !== undefined && input.awayScore !== null && input.awayScore !== undefined;
  return {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: `${input.homeName} vs ${input.awayName}`,
    url: input.canonical,
    startDate: input.scheduledAt,
    ...(eventStatus ? { eventStatus } : {}),
    sport: 'Soccer',
    homeTeam: { '@type': 'SportsTeam', name: input.homeName },
    awayTeam: { '@type': 'SportsTeam', name: input.awayName },
    ...(input.competitionName ? { organizer: { '@type': 'Organization', name: input.competitionName } } : {}),
    ...(input.venueName ? { location: { '@type': 'Place', name: input.venueName } } : {}),
    // Scores only when both sides are known and the match is finished —
    // never stale or contradictory partial information.
    ...((scoreKnown && (input.status ?? '').toLowerCase() === 'finished')
      ? { description: `Full time: ${input.homeName} ${input.homeScore} - ${input.awayScore} ${input.awayName}` }
      : {}),
  };
}
