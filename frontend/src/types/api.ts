/** Shared typed contracts for /api/v1 responses. */

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiEnvelope<T> {
  data: T;
  pagination?: PaginationMeta;
  /** Optional response metadata, e.g. a server-time anchor on live feeds. */
  meta?: Record<string, unknown>;
  requestId: string;
}

export interface ApiErrorBody {
  code: string;
  message: string;
}

export interface Article {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  article_type: string;
  published_at: string | null;
  is_featured: boolean;
  is_breaking: boolean;
  view_count: number;
  content?: string;
}

export interface Team {
  id: string;
  name: string;
  short_name: string | null;
  slug: string;
  logo_url: string | null;
}

export interface Player {
  id: string;
  display_name: string;
  slug: string;
  photo_url: string | null;
  position: string | null;
}

export interface Competition {
  id: string;
  name: string;
  short_name: string | null;
  slug: string;
  logo_url: string | null;
  /** Free-text classification (e.g. `domestic`, `international`, `cup`). */
  type?: string | null;
}

export interface Match {
  id: string;
  slug: string;
  status: string;
  scheduled_at: string;
  home_score: number | null;
  away_score: number | null;
  home_team_id: string;
  away_team_id: string;
  competition_id: string;
  home_score_ht?: number | null;
  away_score_ht?: number | null;
  season_id?: string | null;
  venue_id?: string | null;
  round?: string | number | null;
  matchday?: number | null;
  referee_name?: string | null;
  attendance?: number | null;
}

export interface Transfer {
  id: string;
  status: string;
  player_id: string;
  from_team_id: string | null;
  to_team_id: string | null;
  transfer_type?: string | null;
  announcement_date?: string | null;
  effective_date?: string | null;
  fee?: string | number | null;
  currency?: string | null;
  /**
   * `GET /transfers` resolves these relations for each row. They are absent when
   * the reference is dangling, so consumers must treat them as optional.
   */
  player?: Player | null;
  fromTeam?: Team | null;
  toTeam?: Team | null;
}

/** `match_event_type` enum values the API can return. */
export type MatchEventType =
  | 'goal'
  | 'own_goal'
  | 'penalty_goal'
  | 'missed_penalty'
  | 'yellow_card'
  | 'red_card'
  | 'substitution'
  | 'var';

/**
 * A single match event, as embedded in `/matches/:slug/details`. Mirrors the
 * `EVENT_COLUMNS` the backend selects; `description` is free text from the
 * provider and is optional in practice.
 */
export interface MatchEvent {
  id: string;
  team_id: string | null;
  player_id: string | null;
  assist_player_id: string | null;
  type: MatchEventType | string;
  minute: number | null;
  extra_minute: number | null;
  description: string | null;
}

/**
 * `GET /matches/:slug/details`. List endpoints return bare foreign keys unless
 * asked for `include=card`, which embeds the competition and both clubs (plus
 * minimal events) directly in each row. The details endpoint remains the seam
 * for a full match page, and the fallback when a list row carries no card shape.
 */
export interface MatchDetails {
  match: Match;
  competition: Competition | null;
  homeTeam: Team | null;
  awayTeam: Team | null;
  events: MatchEvent[];
}

export interface Venue {
  id: string;
  name: string;
  city?: string | null;
  slug?: string | null;
  capacity?: number | null;
}

export type SearchableEntityType = 'news' | 'match' | 'team' | 'player' | 'competition';

/** Optional nested entity reference, present only when the backend resolved it. */
export interface SearchEntityRef {
  id: string;
  name: string;
  slug: string;
}

export interface SearchResultMetadata {
  /** Competition country, when known. */
  country?: { id: string; name: string; slug: string } | null;
  /** Match detail: kickoff, state and score as text. */
  scheduled_at?: string | null;
  status?: string | null;
  score?: string | null;
  home_team?: SearchEntityRef | null;
  away_team?: SearchEntityRef | null;
  /** News detail. */
  article_type?: string | null;
  published_at?: string | null;
  /** Player detail: current club, only when a current contract exists. */
  current_team?: SearchEntityRef | null;
}

export interface SearchResultItem {
  entity_type: SearchableEntityType;
  entity_id: string;
  title: string;
  slug: string;
  url: string;
  image: string | null;
  /** Secondary line: position, country or competition name. */
  description: string | null;
  metadata: SearchResultMetadata;
  /** Backend relevance score. The frontend never re-ranks. */
  relevance: number;
}

export interface MediaVariant {
  variant: string;
  width: number | null;
  height: number | null;
  mime_type: string;
  storage_path: string;
  public_url: string | null;
  file_size: number | null;
}

export interface MediaRecord {
  id: string;
  file_name: string;
  mime_type: string;
  width: number | null;
  height: number | null;
  file_size: number | null;
  public_url: string | null;
  alt_text: string | null;
}

export interface SeoMetadata {
  title: string;
  description: string;
  canonical: string;
  robots: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string | null;
  twitterTitle: string;
  twitterDescription: string;
  twitterImage: string | null;
}

export interface BreadcrumbItem {
  name: string;
  url: string;
}

/**
 * Step 16/17 - Admin Dashboard contract.
 * Mirrors `adminDashboardService.summary()` in the backend
 * (`backend/src/admin/services/dashboard.admin.service.ts`) one-for-one; extra
 * keys the backend never returns must not be invented here. Every list is
 * bounded to 5-10 rows by the backend and carries only the fields below.
 */
export interface AdminTransferWindow {
  id: string;
  name: string;
  season_id: string | null;
  start_date: string;
  end_date: string;
}

export interface AdminDashboardNamedRef {
  id: string;
  name: string;
  slug: string;
}

export interface AdminDashboardMatchCard {
  id: string;
  slug: string;
  home_team_id: string;
  away_team_id: string;
  scheduled_at: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  competition_id?: string | null;
  competition?: AdminDashboardNamedRef | null;
  homeTeam?: AdminDashboardNamedRef | null;
  awayTeam?: AdminDashboardNamedRef | null;
  /** Latest match-event minute; null when unknown (matches table has no minute column). */
  latestMinute?: number | null;
  updated_at?: string;
}

export interface AdminDashboardArticleCard {
  id: string;
  title: string;
  slug: string;
  status: string;
  article_type: string;
  published_at: string | null;
  created_at: string;
}

export interface AdminDashboardTransferCard {
  id: string;
  player_id: string;
  from_team_id: string | null;
  to_team_id: string | null;
  status: string;
  effective_date: string | null;
  created_at: string;
  player?: AdminDashboardNamedRef | null;
  fromTeam?: AdminDashboardNamedRef | null;
  toTeam?: AdminDashboardNamedRef | null;
}

export interface AdminDashboardSyncSource {
  id: string;
  name: string;
  provider: string;
  isActive: boolean;
}

export interface AdminDashboardSyncError {
  id: string;
  syncJobId: string | null;
  entityType: string | null;
  errorCode: string | null;
  message: string;
  createdAt: string;
}

export interface AdminDashboardSyncDomain {
  domain: string;
  status: string;
  at: string | null;
}

export interface AdminDashboardSync {
  queued: number;
  running: number;
  failed: number;
  completed: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureMessage: string | null;
  sources: AdminDashboardSyncSource[];
  recentErrors: AdminDashboardSyncError[];
  byDomain: AdminDashboardSyncDomain[];
}

export interface AdminDashboardActivityEntry {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  created_at: string;
}

export interface AdminDashboard {
  articles: { total: number; published: number; draft: number; archived: number; breaking: number; review?: number; scheduled?: number; scheduledOverdue?: number };
  transfers: { total: number; rumour?: number };
  matches: { upcoming: number; live: number; finished: number; today: number; total?: number; attention?: number };
  teams: { total: number };
  players: { total: number };
  competitions: { total: number };
  seasons: { total: number };
  venues: { total: number };
  adminUsers: { total: number; active: number; disabled: number };
  sync?: AdminDashboardSync;
  freshness?: { matchesAt: string | null; articlesAt: string | null; transfersAt: string | null };
  activeWindow: AdminTransferWindow | null;
  liveMatches: AdminDashboardMatchCard[];
  upcomingMatches: AdminDashboardMatchCard[];
  recentMatches?: AdminDashboardMatchCard[];
  recentArticles: AdminDashboardArticleCard[];
  recentTransfers: AdminDashboardTransferCard[];
  recentActivity: AdminDashboardActivityEntry[];
}

/**
 * Step 18 - Admin articles contract.
 * Mirrors `adminArticlesService.list()` row columns and the editorial row
 * returned by `articlesService.getEditorial()` / create / update. Field names
 * stay snake_case exactly as the backend returns them.
 */
export interface AdminArticleListRow {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  status: string;
  article_type: string;
  author_id: string | null;
  featured_image_id: string | null;
  published_at: string | null;
  scheduled_at: string | null;
  is_breaking: boolean;
  is_featured: boolean;
  view_count: number;
  created_at: string;
  updated_at: string;
}

export interface AdminArticleEditorial extends AdminArticleListRow {
  content?: string | null;
  /** Related-id arrays from getEditorial() (ids resolved client-side). */
  categories?: string[];
  tags?: string[];
  teams?: string[];
  players?: string[];
  competitions?: string[];
  matches?: string[];
  seo?: unknown;
}

export interface AdminArticleCreateInput {
  title: string;
  slug?: string;
  excerpt?: string;
  content: string;
  articleType: string;
  categoryIds?: string[];
  tagIds?: string[];
  teamIds?: string[];
  playerIds?: string[];
  competitionIds?: string[];
  matchIds?: string[];
  featuredImageId?: string | null;
  isFeatured?: boolean;
  isBreaking?: boolean;
}

export interface AdminArticleUpdateInput {
  title?: string;
  slug?: string;
  excerpt?: string | null;
  content?: string;
  articleType?: string;
  featuredImageId?: string | null;
  isFeatured?: boolean;
  isBreaking?: boolean;
}

/**
 * Step 19 - Admin transfers contract.
 * Mirrors `adminTransfersService` list/get/create/update. The list endpoint
 * returns bare foreign keys only; `get` resolves player/fromTeam/toTeam/
 * season/window names. Status/type enums come from the backend service.
 */
export const ADMIN_TRANSFER_STATUSES = ['rumour', 'announced', 'completed', 'cancelled', 'rejected'] as const;
export const ADMIN_TRANSFER_TYPES = ['permanent', 'loan', 'loan_return', 'free_transfer'] as const;
export type AdminTransferStatus = (typeof ADMIN_TRANSFER_STATUSES)[number];
export type AdminTransferType = (typeof ADMIN_TRANSFER_TYPES)[number];

export interface AdminTransferRow {
  id: string;
  player_id: string;
  from_team_id: string | null;
  to_team_id: string | null;
  transfer_type: string;
  status: string;
  fee: number | null;
  currency: string | null;
  announcement_date: string | null;
  effective_date: string | null;
  season_id: string;
  window_id: string | null;
  metadata?: unknown;
  created_at: string;
  updated_at: string;
}

export interface AdminTransferEntityRef {
  id: string;
  name?: string | null;
  display_name?: string | null;
  slug?: string | null;
}

export interface AdminTransferDetail extends AdminTransferRow {
  player?: AdminTransferEntityRef | null;
  fromTeam?: AdminTransferEntityRef | null;
  toTeam?: AdminTransferEntityRef | null;
  season?: { id: string; name: string; competition_id?: string | null } | null;
  window?: { id: string; name: string; season_id: string; start_date: string; end_date: string } | null;
}

export interface AdminTransferCreateInput {
  player_id: string;
  season_id: string;
  transfer_type: string;
  from_team_id?: string | null;
  to_team_id?: string | null;
  status?: string;
  fee?: number | null;
  currency?: string | null;
  announcement_date?: string | null;
  effective_date?: string | null;
  window_id?: string | null;
}

export interface AdminTransferUpdateInput {
  player_id?: string;
  season_id?: string;
  transfer_type?: string;
  from_team_id?: string | null;
  to_team_id?: string | null;
  status?: string;
  fee?: number | null;
  currency?: string | null;
  announcement_date?: string | null;
  effective_date?: string | null;
  window_id?: string | null;
}

/**
 * Step 20 - Admin matches contract. Mirrors `adminMatchesService` list/get/
 * create/update and the match-events service (nested under /admin/matches/:id).
 * Event permission is `match_events.manage` (single grant for all event ops).
 */
export const MATCH_STATUSES = [
  'scheduled', 'pre_match', 'live', 'half_time', 'extra_time', 'penalty_shootout',
  'finished', 'postponed', 'cancelled', 'abandoned', 'suspended',
] as const;
export type MatchStatusValue = (typeof MATCH_STATUSES)[number];

export const MATCH_EVENT_TYPES = [
  'goal', 'own_goal', 'penalty_goal', 'missed_penalty',
  'yellow_card', 'red_card', 'substitution', 'var',
] as const;
export type MatchEventTypeValue = (typeof MATCH_EVENT_TYPES)[number];

export interface AdminMatchRow {
  id: string;
  slug: string;
  competition_id: string;
  season_id: string | null;
  venue_id: string | null;
  home_team_id: string;
  away_team_id: string;
  scheduled_at: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  home_score_ht: number | null;
  away_score_ht: number | null;
  home_score_et: number | null;
  away_score_et: number | null;
  home_score_pen: number | null;
  away_score_pen: number | null;
  round: string | null;
  matchday: number | null;
  referee_name: string | null;
  attendance: number | null;
  created_at: string;
  updated_at: string;
}

export interface AdminMatchDetail extends AdminMatchRow {
  homeTeam?: { id: string; name: string; slug?: string | null } | null;
  awayTeam?: { id: string; name: string; slug?: string | null } | null;
  competition?: { id: string; name: string; slug?: string | null } | null;
  season?: { id: string; name: string; competition_id?: string | null } | null;
  venue?: { id: string; name: string; slug?: string | null } | null;
  /** Counts of dependent rows; a non-zero total means delete is blocked (409). */
  dependents?: Record<string, number> | null;
}

export interface AdminMatchCreateInput {
  slug?: string;
  competition_id: string;
  season_id?: string | null;
  venue_id?: string | null;
  home_team_id: string;
  away_team_id: string;
  scheduled_at: string;
  status?: string;
  home_score?: number | null;
  away_score?: number | null;
  round?: string | null;
  matchday?: number | null;
  referee_name?: string | null;
  attendance?: number | null;
}

export type AdminMatchUpdateInput = Partial<AdminMatchCreateInput>;

export interface AdminMatchEvent {
  id: string;
  match_id: string;
  team_id: string | null;
  player_id: string | null;
  assist_player_id: string | null;
  type: string;
  minute: number | null;
  extra_minute: number | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminMatchEventCreateInput {
  team_id?: string | null;
  player_id?: string | null;
  assist_player_id?: string | null;
  type: string;
  minute?: number | null;
  extra_minute?: number | null;
  description?: string | null;
}

export type AdminMatchEventUpdateInput = Partial<AdminMatchEventCreateInput>;

/* -- Control Center reference modules ----------------------------------------
 * Shapes below mirror what `/api/v1/admin/*` actually returns for the list
 * endpoints (verified against a live response per entity). Nullable columns stay
 * nullable: the tables render "—" rather than coercing a missing value into 0 or
 * an empty string, which would read as real data.
 */

export interface AdminTeamRow {
  id: string;
  name: string;
  short_name: string | null;
  slug: string;
  country_id: string | null;
  logo_url: string | null;
  founded_year: number | null;
  venue_id: string | null;
  website_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type AdminTeamCreateInput = Partial<Omit<AdminTeamRow, 'id' | 'created_at' | 'updated_at'>> & {
  name: string;
};

export type AdminTeamUpdateInput = Partial<AdminTeamCreateInput>;

export interface AdminPlayerRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string;
  slug: string;
  date_of_birth: string | null;
  nationality_id: string | null;
  position: string | null;
  preferred_foot: string | null;
  height_cm: number | null;
  photo_url: string | null;
  status: string | null;
  created_at: string;
  updated_at: string;
}

export type AdminPlayerCreateInput = Partial<Omit<AdminPlayerRow, 'id' | 'created_at' | 'updated_at'>> & {
  display_name: string;
};

export type AdminPlayerUpdateInput = Partial<AdminPlayerCreateInput>;

export interface AdminCompetitionRow {
  id: string;
  name: string;
  short_name: string | null;
  slug: string;
  country_id: string | null;
  logo_url: string | null;
  type: string | null;
  gender: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type AdminCompetitionCreateInput = Partial<Omit<AdminCompetitionRow, 'id' | 'created_at' | 'updated_at'>> & {
  name: string;
};

export type AdminCompetitionUpdateInput = Partial<AdminCompetitionCreateInput>;

export interface AdminSeasonRow {
  id: string;
  competition_id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean;
  created_at: string;
  updated_at: string;
}

export type AdminSeasonCreateInput = Partial<Omit<AdminSeasonRow, 'id' | 'created_at' | 'updated_at'>> & {
  competition_id: string;
  name: string;
};

export type AdminSeasonUpdateInput = Partial<AdminSeasonCreateInput>;

export interface AdminVenueRow {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  country_id: string | null;
  capacity: number | null;
  image_url: string | null;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
  updated_at: string;
}

export type AdminVenueCreateInput = Partial<Omit<AdminVenueRow, 'id' | 'created_at' | 'updated_at'>> & {
  name: string;
};

export type AdminVenueUpdateInput = Partial<AdminVenueCreateInput>;

/** Media list row. Variants are fetched separately from `/admin/media/:id`. */
export interface AdminMediaRow {
  id: string;
  filename: string;
  mime_type: string;
  file_size: number;
  width: number | null;
  height: number | null;
  alt_text: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export type AdminMediaUpdateInput = Partial<Pick<AdminMediaRow, 'alt_text' | 'filename'>>;

/** `system_settings` is a flat key/value table; values stay as JSON scalars. */
export interface AdminSettingRow {
  key: string;
  value: unknown;
  description: string | null;
  updated_at: string;
}

/** Row from the `admin_users` view (service-role only; migration 025). */
export interface AdminUserRow {
  id: string;
  email: string;
  status: string;
  roles: string[];
  created_at: string;
  last_sign_in_at: string | null;
}

/**
 * Row from GET /admin/roles.
 *
 * Note the numeric id: roles predate the admin RBAC tables and use a serial
 * key, not a UUID. Verified against a live response.
 */
export interface AdminRoleRow {
  id: number;
  name: string;
  description: string | null;
  memberCount: number;
  created_at: string;
}

export interface AdminPermissionRow {
  id: string;
  key: string;
  description: string | null;
  group: string | null;
}

export interface AdminAuditLogRow {
  id: string;
  user_id: string | null;
  user_email: string | null;
  action: string;
  resource: string;
  resource_id: string | null;
  created_at: string;
}
