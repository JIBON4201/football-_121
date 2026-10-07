import { routeUrl } from '@/config/routes';
import { ArticleCard } from '@/components/news/ArticleCard';
import { sanitizeText } from '@/lib/validation';
import {
  statusLabel,
  toTransferQuery,
  TRANSFER_SORT_FIELDS,
  TRANSFER_STATUSES,
  TRANSFER_TYPES,
  typeLabel,
  TRANSFER_PAGE_SIZE,
  type Article,
  type TransferFilters,
  type TransferSortField,
  type TransferStatus,
  type TransferType,
  type TransferWindow,
} from '@/lib/transfers';

const SORT_FIELD_LABELS: Record<TransferSortField, string> = {
  announcement_date: 'Announcement date',
  effective_date: 'Effective date',
};

interface TransferFilterFormProps {
  filters: TransferFilters;
  windows: TransferWindow[];
  resultCount: number;
}

/**
 * Filter toolbar. A plain GET form: every filter is applied by the backend, so
 * the page works without JavaScript and nothing is filtered in the browser.
 */
export function TransferFilterForm({ filters, windows, resultCount }: TransferFilterFormProps) {
  const active =
    filters.status !== null ||
    filters.type !== null ||
    filters.player !== null ||
    filters.team !== null ||
    filters.fromTeam !== null ||
    filters.toTeam !== null ||
    filters.season !== null ||
    filters.window !== null;
  const windowOptions = filters.season
    ? windows.filter((entry) => entry.season_id === filters.season)
    : windows;

  return (
    <form className="transfer-filters" method="get" action={routeUrl('transfers')} role="search">
      <div className="transfer-filters__grid">
        <p className="transfer-filters__field">
          <label htmlFor="transfer-status">Status</label>
          <select id="transfer-status" name="status" defaultValue={filters.status ?? ''}>
            <option value="">Confirmed only</option>
            {TRANSFER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {statusLabel(status)}
              </option>
            ))}
          </select>
        </p>

        {filters.status && filters.status !== 'announced' && filters.status !== 'completed' ? (
          <p className="transfer-filters__field">
            <label htmlFor="transfer-include-unconfirmed">Include unconfirmed</label>
            <span className="transfer-filters__check">
              <input
                id="transfer-include-unconfirmed"
                type="checkbox"
                name="includeUnconfirmed"
                value="true"
                defaultChecked={filters.includeUnconfirmed}
              />
              <span>Show unconfirmed records</span>
            </span>
          </p>
        ) : null}

        <p className="transfer-filters__field">
          <label htmlFor="transfer-type">Type</label>
          <select id="transfer-type" name="type" defaultValue={filters.type ?? ''}>
            <option value="">All types</option>
            {TRANSFER_TYPES.map((type) => (
              <option key={type} value={type}>
                {typeLabel(type)}
              </option>
            ))}
          </select>
        </p>

        <p className="transfer-filters__field">
          <label htmlFor="transfer-player">Player slug</label>
          <input id="transfer-player" type="text" name="player" defaultValue={filters.player ?? ''} placeholder="e.g. john-doe" />
        </p>

        <p className="transfer-filters__field">
          <label htmlFor="transfer-team">Club slug</label>
          <input id="transfer-team" type="text" name="team" defaultValue={filters.team ?? ''} placeholder="Involving this club" />
        </p>

        <p className="transfer-filters__field">
          <label htmlFor="transfer-from">From club slug</label>
          <input id="transfer-from" type="text" name="fromTeam" defaultValue={filters.fromTeam ?? ''} placeholder="Outgoing" />
        </p>

        <p className="transfer-filters__field">
          <label htmlFor="transfer-to">To club slug</label>
          <input id="transfer-to" type="text" name="toTeam" defaultValue={filters.toTeam ?? ''} placeholder="Incoming" />
        </p>

        <p className="transfer-filters__field">
          <label htmlFor="transfer-window">Transfer window</label>
          <select id="transfer-window" name="window" defaultValue={filters.window ?? ''}>
            <option value="">All windows</option>
            {windowOptions.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {sanitizeText(entry.name)}
                {entry.start_date ? ` (${sanitizeText(entry.start_date)})` : ''}
              </option>
            ))}
          </select>
        </p>

        <p className="transfer-filters__field">
          <label htmlFor="transfer-sort-field">Sort by</label>
          <select id="transfer-sort-field" name="sortField" defaultValue={filters.sortField}>
            {TRANSFER_SORT_FIELDS.map((field) => (
              <option key={field} value={field}>
                {SORT_FIELD_LABELS[field]}
              </option>
            ))}
          </select>
        </p>

        <p className="transfer-filters__field">
          <label htmlFor="transfer-sort">Order</label>
          <select id="transfer-sort" name="sort" defaultValue={filters.sort}>
            <option value="desc">Newest first</option>
            <option value="asc">Oldest first</option>
          </select>
        </p>
      </div>

      <p className="transfer-filters__actions">
        <button type="submit">Apply filters</button>
        {active || resultCount > 0 ? (
          <a className="transfer-filters__reset" href={routeUrl('transfers')}>
            Clear all filters
          </a>
        ) : null}
      </p>
    </form>
  );
}

/** Default filter set, used by the shortcut chips. */
function defaultFilters(overrides: Partial<TransferFilters> = {}): TransferFilters {
  return {
    page: 1,
    limit: TRANSFER_PAGE_SIZE,
    status: null,
    type: null,
    player: null,
    team: null,
    fromTeam: null,
    toTeam: null,
    season: null,
    window: null,
    includeUnconfirmed: false,
    sort: 'desc',
    sortField: 'effective_date',
    ...overrides,
  };
}

/** Status shortcut: confirmed by default, rumours only on explicit request. */
export function TransferStatusFilter({ current }: { current: TransferStatus | null }) {
  return (
    <nav className="transfer-status-filter" aria-label="Transfer status">
      <a href={routeUrl('transfers')} aria-current={current === null ? 'page' : undefined}>
        Confirmed
      </a>
      <a
        href={`${routeUrl('transfers')}${toTransferQuery(
          defaultFilters({ status: 'rumour', includeUnconfirmed: true }),
        )}`}
        aria-current={current === 'rumour' ? 'page' : undefined}
      >
        Rumours
      </a>
    </nav>
  );
}

interface TransferNewsProps {
  articles: Article[];
  status: 'ready' | 'empty' | 'error';
}

/** Editorial transfer coverage, visually separate from structured records. */
export function TransferNewsSection({ articles, status }: TransferNewsProps) {
  return (
    <section className="transfer-news" aria-labelledby="transfer-news-heading">
      <h2 id="transfer-news-heading">Transfer news</h2>
      <p className="transfer-news__note">Editorial coverage, separate from the confirmed records above.</p>
      {status === 'error' ? (
        <p role="status">Transfer news is temporarily unavailable.</p>
      ) : articles.length === 0 ? (
        <p>No published transfer stories are available right now.</p>
      ) : (
        <ul className="grid-cards">
          {articles.map((article) => (
            <li key={article.id}>
              <ArticleCard article={article} href={`/news/${article.slug}`} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export type { TransferType };
