import { siteConfig } from '@/config/site';
import { routeUrl } from '@/config/routes';
import { fetchServer, type PaginatedResult } from '@/lib/data-fetch';
import { isValidSlug, parsePositiveInt } from '@/lib/validation';
import type { CompetitionRecord, Season } from '@/lib/competitions';
import type { Article, PaginationMeta, Player, Team } from '@/types/api';

/**
 * Transfer data layer.
 *
 * Transfers have a uuid identity and no slug, so the canonical URL is
 * `/transfers/{id}` — stable for the life of the record and never derived from
 * a provider. Every filter is applied by the backend, and rumours are only
 * requested when a reader explicitly opts in, so an unconfirmed row can never
 * be presented as a completed move.
 */

export const TRANSFER_PAGE_SIZE = 20;
export const TRANSFER_REVALIDATE = {
  list: 300,
  detail: 600,
  windows: 3600,
  news: 300,
} as const;

export const TRANSFER_STATUSES = ['rumour', 'announced', 'completed', 'cancelled', 'rejected'] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

/** Statuses that represent a confirmed, public move. */
export const CONFIRMED_STATUSES: ReadonlySet<TransferStatus> = new Set<TransferStatus>(['announced', 'completed']);

/** Statuses that are not a confirmed move and must never read as one. */
export const UNCONFIRMED_STATUSES: ReadonlySet<TransferStatus> = new Set<TransferStatus>([
  'rumour',
  'cancelled',
  'rejected',
]);

export function isConfirmedStatus(status: TransferStatus): boolean {
  return CONFIRMED_STATUSES.has(status);
}

export const TRANSFER_TYPES = ['permanent', 'loan', 'loan_return', 'free_transfer'] as const;
export type TransferType = (typeof TRANSFER_TYPES)[number];

const STATUS_LABELS: Record<TransferStatus, string> = {
  rumour: 'Rumour',
  announced: 'Announced',
  completed: 'Completed',
  cancelled: 'Cancelled',
  rejected: 'Rejected',
};

const TYPE_LABELS: Record<TransferType, string> = {
  permanent: 'Permanent',
  loan: 'Loan',
  loan_return: 'Loan return',
  free_transfer: 'Free transfer',
};

/** Human label for a status; the canonical enum is preserved in the payload. */
export function statusLabel(status: TransferStatus): string {
  return STATUS_LABELS[status];
}

/** Human label for a transfer type. */
export function typeLabel(type: TransferType): string {
  return TYPE_LABELS[type];
}

function asStatus(value: unknown): TransferStatus | null {
  return TRANSFER_STATUSES.find((status) => status === value) ?? null;
}

function asType(value: unknown): TransferType | null {
  return TRANSFER_TYPES.find((type) => type === value) ?? null;
}

/** A transfer window. A season is not assumed to have one. */
export interface TransferWindow {
  id: string;
  name: string;
  season_id: string;
  start_date: string | null;
  end_date: string | null;
}

/** The canonical transfer record. */
export interface TransferRecord {
  id: string;
  player_id: string;
  from_team_id: string | null;
  to_team_id: string | null;
  transfer_type: TransferType | null;
  status: TransferStatus;
  fee: number | null;
  currency: string | null;
  announcement_date: string | null;
  effective_date: string | null;
  season_id: string | null;
  window_id: string | null;
}

/** A listing row: the record plus the player and both teams, resolved once. */
export interface TransferListItem {
  transfer: TransferRecord;
  player: Player | null;
  fromTeam: Team | null;
  toTeam: Team | null;
}

/** The full detail payload, including season, window and competition context. */
export interface TransferDetail extends TransferListItem {
  season: Season | null;
  window: TransferWindow | null;
  competition: CompetitionRecord | null;
}

// ---------------------------------------------------------------------------
// Fee presentation
// ---------------------------------------------------------------------------

export type FeeKind = 'known' | 'free' | 'undisclosed';

/**
 * Classify a fee without inventing a value.
 *
 * A null fee is "undisclosed", never zero. A `free_transfer` is shown as free
 * even when no fee was recorded, because the transfer type states it. An
 * explicit zero fee is a real, known figure.
 */
export function classifyFee(fee: number | null, transferType: TransferType | null): FeeKind {
  if (fee !== null && Number.isFinite(fee)) return fee === 0 ? 'free' : 'known';
  return transferType === 'free_transfer' ? 'free' : 'undisclosed';
}

/**
 * Format a fee for display. Returns null when the fee is unknown so callers
 * render their own "undisclosed" wording rather than a misleading number.
 */
export function formatFee(fee: number | null, currency: string | null, transferType: TransferType | null): string | null {
  const kind = classifyFee(fee, transferType);
  if (kind === 'undisclosed') return null;
  if (kind === 'free') return 'Free';
  const value = fee as number;
  // Respect the stored currency; never assume a default.
  const formatted = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(value);
  return currency ? `${currency} ${formatted}` : formatted;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asPlayer(value: unknown): Player | null {
  if (!isRecord(value)) return null;
  const displayName = asString(value.display_name);
  const slug = asString(value.slug);
  if (!displayName || !slug) return null;
  return {
    id: asString(value.id) ?? slug,
    display_name: displayName,
    slug,
    photo_url: asString(value.photo_url),
    position: asString(value.position),
  };
}

function asTeam(value: unknown): Team | null {
  if (!isRecord(value)) return null;
  const name = asString(value.name);
  const slug = asString(value.slug);
  if (!name || !slug) return null;
  return {
    id: asString(value.id) ?? slug,
    name,
    short_name: asString(value.short_name),
    slug,
    logo_url: asString(value.logo_url),
  };
}

function asSeason(value: unknown): Season | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  const name = asString(value.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    competition_id: asString(value.competition_id) ?? '',
    start_date: asString(value.start_date),
    end_date: asString(value.end_date),
    is_current: value.is_current === true,
  };
}

function asWindow(value: unknown): TransferWindow | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  const name = asString(value.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    season_id: asString(value.season_id) ?? '',
    start_date: asString(value.start_date),
    end_date: asString(value.end_date),
  };
}

function asCompetition(value: unknown): CompetitionRecord | null {
  if (!isRecord(value)) return null;
  const name = asString(value.name);
  const slug = asString(value.slug);
  if (!name || !slug) return null;
  return {
    id: asString(value.id) ?? slug,
    name,
    short_name: asString(value.short_name),
    slug,
    logo_url: asString(value.logo_url),
    is_active: value.is_active === true,
  };
}

function asArticle(row: unknown): Article | null {
  if (!isRecord(row)) return null;
  const slug = asString(row.slug);
  const title = asString(row.title);
  if (!slug || !title) return null;
  return {
    id: asString(row.id) ?? slug,
    title,
    slug,
    excerpt: asString(row.excerpt),
    article_type: asString(row.article_type) ?? 'news',
    published_at: asString(row.published_at),
    is_featured: row.is_featured === true,
    is_breaking: row.is_breaking === true,
    view_count: asNumber(row.view_count) ?? 0,
  };
}

/** Narrow a raw transfer row. A row without an id or a known status is dropped. */
export function asTransferRecord(value: unknown): TransferRecord | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  const status = asStatus(value.status);
  if (!id || !status) return null;
  return {
    id,
    player_id: asString(value.player_id) ?? '',
    from_team_id: asString(value.from_team_id),
    to_team_id: asString(value.to_team_id),
    transfer_type: asType(value.transfer_type),
    status,
    fee: asNumber(value.fee),
    currency: asString(value.currency),
    announcement_date: asString(value.announcement_date),
    effective_date: asString(value.effective_date),
    season_id: asString(value.season_id),
    window_id: asString(value.window_id),
  };
}

/** Narrow one enriched listing row: record plus its player and both teams. */
export function asTransferListItem(value: unknown): TransferListItem | null {
  if (!isRecord(value)) return null;
  const transfer = asTransferRecord(value);
  if (!transfer) return null;
  return {
    transfer,
    player: asPlayer(value.player),
    fromTeam: asTeam(value.fromTeam),
    toTeam: asTeam(value.toTeam),
  };
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export const TRANSFER_SORT_FIELDS = ['announcement_date', 'effective_date'] as const;
export type TransferSortField = (typeof TRANSFER_SORT_FIELDS)[number];

export interface TransferFilters {
  page: number;
  limit: number;
  status: TransferStatus | null;
  type: TransferType | null;
  player: string | null;
  team: string | null;
  fromTeam: string | null;
  toTeam: string | null;
  season: string | null;
  window: string | null;
  includeUnconfirmed: boolean;
  sort: 'asc' | 'desc';
  sortField: TransferSortField;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function optionalSlug(value: string | undefined): string | null {
  return value && isValidSlug(value) ? value : null;
}

function optionalUuid(value: string | undefined): string | null {
  return value && UUID.test(value) ? value.toLowerCase() : null;
}

/** Parse listing filters, dropping anything unrecognised. */
export function parseTransferFilters(searchParams: Record<string, string | string[] | undefined>): TransferFilters {
  const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);
  const sortField = first(searchParams.sortField);
  return {
    page: parsePositiveInt(searchParams.page, 1),
    limit: Math.min(parsePositiveInt(searchParams.limit, TRANSFER_PAGE_SIZE), 50),
    status: asStatus(first(searchParams.status)),
    type: asType(first(searchParams.type)),
    player: optionalSlug(first(searchParams.player)),
    team: optionalSlug(first(searchParams.team)),
    fromTeam: optionalSlug(first(searchParams.fromTeam)),
    toTeam: optionalSlug(first(searchParams.toTeam)),
    season: optionalUuid(first(searchParams.season)),
    window: optionalUuid(first(searchParams.window)),
    // Rumours are only ever requested deliberately.
    includeUnconfirmed: first(searchParams.includeUnconfirmed) === 'true',
    sort: first(searchParams.sort) === 'asc' ? 'asc' : 'desc',
    sortField: TRANSFER_SORT_FIELDS.find((field) => field === sortField) ?? 'effective_date',
  };
}

/**
 * Whether this selection touches anything that is not a confirmed move.
 *
 * Choosing an unconfirmed status *is* the acknowledgement, so the parameter is
 * always sent alongside it. Without this the site would generate a URL its own
 * API rejects, and a rumour could be requested without the request being
 * self-describing.
 */
export function filtersIncludeUnconfirmed(filters: TransferFilters): boolean {
  return filters.includeUnconfirmed || (filters.status !== null && UNCONFIRMED_STATUSES.has(filters.status));
}

export function toTransferQuery(filters: TransferFilters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filtersIncludeUnconfirmed(filters)) params.set('includeUnconfirmed', 'true');
  if (filters.type) params.set('type', filters.type);
  if (filters.player) params.set('player', filters.player);
  if (filters.team) params.set('team', filters.team);
  if (filters.fromTeam) params.set('fromTeam', filters.fromTeam);
  if (filters.toTeam) params.set('toTeam', filters.toTeam);
  if (filters.season) params.set('season', filters.season);
  if (filters.window) params.set('window', filters.window);
  if (filters.sort !== 'desc') params.set('sort', filters.sort);
  if (filters.sortField !== 'effective_date') params.set('sortField', filters.sortField);
  if (filters.page > 1) params.set('page', String(filters.page));
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** Extra query preserved across pages of the listing. */
export function transferPageQuery(filters: TransferFilters): Record<string, string> {
  const query: Record<string, string> = {};
  if (filters.status) query.status = filters.status;
  if (filtersIncludeUnconfirmed(filters)) query.includeUnconfirmed = 'true';
  if (filters.type) query.type = filters.type;
  if (filters.player) query.player = filters.player;
  if (filters.team) query.team = filters.team;
  if (filters.fromTeam) query.fromTeam = filters.fromTeam;
  if (filters.toTeam) query.toTeam = filters.toTeam;
  if (filters.season) query.season = filters.season;
  if (filters.window) query.window = filters.window;
  if (filters.sort !== 'desc') query.sort = filters.sort;
  if (filters.sortField !== 'effective_date') query.sortField = filters.sortField;
  return query;
}

export const TRANSFERS_CANONICAL = routeUrl('transfers');
export const TRANSFERS_CANONICAL_URL = `${siteConfig.siteUrl}${TRANSFERS_CANONICAL}`;

/**
 * The one canonical URL for a transfer record. Transfers have no slug, so the
 * uuid is the stable identity — never a provider identifier.
 */
export function transferUrl(id: string): string {
  return `${TRANSFERS_CANONICAL}/${id}`;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

export type TransferListStatus = 'ready' | 'empty' | 'error';

export interface TransferListResult extends PaginatedResult<TransferListItem> {
  status: TransferListStatus;
  filters: TransferFilters;
  /** True when this page holds any non-confirmed row. */
  hasUnconfirmed: boolean;
}

/**
 * Paginated transfer listing. Each row arrives with its player and both teams
 * already resolved by the backend, so a page costs a constant number of
 * requests and the browser never joins anything itself.
 */
export async function fetchTransferList(filters: TransferFilters): Promise<TransferListResult> {
  const params: Record<string, string | number | undefined> = {
    page: filters.page,
    limit: filters.limit,
    status: filters.status ?? undefined,
    includeUnconfirmed: filtersIncludeUnconfirmed(filters) ? 'true' : undefined,
    type: filters.type ?? undefined,
    player: filters.player ?? undefined,
    team: filters.team ?? undefined,
    fromTeam: filters.fromTeam ?? undefined,
    toTeam: filters.toTeam ?? undefined,
    season: filters.season ?? undefined,
    window: filters.window ?? undefined,
    sort: filters.sort,
    sortField: filters.sortField,
  };
  try {
    const envelope = await fetchServer<unknown>('/transfers', {
      params,
      revalidate: TRANSFER_REVALIDATE.list,
      tags: ['transfers-list'],
    });
    const rows = (Array.isArray(envelope.data) ? envelope.data : [])
      .map(asTransferListItem)
      .filter((row): row is TransferListItem => row !== null);
    const pagination: PaginationMeta = envelope.pagination ?? {
      page: filters.page,
      limit: filters.limit,
      total: rows.length,
      totalPages: rows.length === 0 ? 0 : 1,
    };
    return {
      rows,
      pagination,
      status: rows.length === 0 ? 'empty' : 'ready',
      filters,
      hasUnconfirmed: rows.some((row) => UNCONFIRMED_STATUSES.has(row.transfer.status)),
    };
  } catch {
    return {
      rows: [],
      pagination: { page: filters.page, limit: filters.limit, total: 0, totalPages: 0 },
      status: 'error',
      filters,
      hasUnconfirmed: false,
    };
  }
}

export type SectionStatus = 'ready' | 'empty' | 'error';

export interface SectionResult<T> {
  status: SectionStatus;
  items: T[];
}

/** Transfer windows for the season filter, bounded to a single page. */
export async function fetchTransferWindows(
  options: { season?: string | null; limit?: number } = {},
): Promise<SectionResult<TransferWindow>> {
  const limit = Math.min(options.limit ?? 50, 100);
  try {
    const envelope = await fetchServer<unknown>('/transfers/windows', {
      page: 1,
      limit,
      params: { season: options.season ?? undefined },
      revalidate: TRANSFER_REVALIDATE.windows,
      tags: ['transfer-windows'],
    });
    const items = (Array.isArray(envelope.data) ? envelope.data : [])
      .map(asWindow)
      .filter((item): item is TransferWindow => item !== null);
    return { status: items.length === 0 ? 'empty' : 'ready', items };
  } catch {
    return { status: 'error', items: [] };
  }
}

/** Editorial transfer coverage, kept separate from structured records. */
export async function fetchTransferNews(limit = 6): Promise<SectionResult<Article>> {
  try {
    const envelope = await fetchServer<unknown>('/news', {
      page: 1,
      limit,
      params: { type: 'transfer' },
      revalidate: TRANSFER_REVALIDATE.news,
      tags: ['transfer-news'],
    });
    const items = (Array.isArray(envelope.data) ? envelope.data : [])
      .map(asArticle)
      .filter((item): item is Article => item !== null);
    return { status: items.length === 0 ? 'empty' : 'ready', items };
  } catch {
    return { status: 'error', items: [] };
  }
}

/** Transfer news linked to a specific player, when the relation exists. */
export async function fetchPlayerTransferNews(slug: string, limit = 4): Promise<SectionResult<Article>> {
  if (!isValidSlug(slug)) return { status: 'error', items: [] };
  try {
    const envelope = await fetchServer<unknown>('/news', {
      page: 1,
      limit,
      params: { player: slug, type: 'transfer' },
      revalidate: TRANSFER_REVALIDATE.news,
      tags: [`player-transfer-news:${slug}`],
    });
    const items = (Array.isArray(envelope.data) ? envelope.data : [])
      .map(asArticle)
      .filter((item): item is Article => item !== null);
    return { status: items.length === 0 ? 'empty' : 'ready', items };
  } catch {
    return { status: 'error', items: [] };
  }
}

export type TransferDetailStatus = 'ready' | 'not-found' | 'error';

export interface TransferDetailResult {
  status: TransferDetailStatus;
  detail: TransferDetail | null;
}

const UUID_OR_NULL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Aggregated transfer record for the detail page. */
export async function fetchTransferDetail(id: string): Promise<TransferDetailResult> {
  if (!UUID_OR_NULL.test(id)) return { status: 'not-found', detail: null };
  try {
    const envelope = await fetchServer<unknown>(`/transfers/${id}/details`, {
      revalidate: TRANSFER_REVALIDATE.detail,
      tags: [`transfer-detail:${id}`],
    });
    const data = envelope.data;
    if (!isRecord(data)) return { status: 'not-found', detail: null };
    const transfer = asTransferRecord(data.transfer);
    if (!transfer) return { status: 'not-found', detail: null };
    return {
      status: 'ready',
      detail: {
        transfer,
        player: asPlayer(data.player),
        fromTeam: asTeam(data.fromTeam),
        toTeam: asTeam(data.toTeam),
        season: asSeason(data.season),
        window: asWindow(data.window),
        competition: asCompetition(data.competition),
      },
    };
  } catch (error: unknown) {
    const code = (error as { status?: number })?.status;
    if (code === 404) return { status: 'not-found', detail: null };
    return { status: 'error', detail: null };
  }
}

export { ISO_DATE };
export type { Article, CompetitionRecord, Player, Season, Team };
