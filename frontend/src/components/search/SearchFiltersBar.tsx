'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  buildSearchUrl,
  SEARCH_GROUP_LABELS,
  SEARCHABLE_TYPES,
  type SearchFilters,
  type SearchableType,
} from '@/lib/search';
import { sanitizeText } from '@/lib/validation';

interface SearchFiltersBarProps {
  filters: SearchFilters;
  /** Competitions available as filter values, from the existing catalog API. */
  competitions?: Array<{ slug: string; name: string }>;
  /** Teams available as filter values, from the existing catalog API. */
  teams?: Array<{ slug: string; name: string }>;
}

/**
 * Result filters.
 *
 * Every change is written to the URL, which is the single source of truth: the
 * server re-renders from the new query, so results stay shareable, the back
 * button works, and the frontend never has to duplicate filtering logic. The
 * page is reset to 1 whenever a filter changes, because page N of a different
 * result set is meaningless.
 */
export function SearchFiltersBar({ filters, competitions = [], teams = [] }: SearchFiltersBarProps) {
  const router = useRouter();
  const [type, setType] = useState<SearchableType | null>(filters.type);
  const [competition, setCompetition] = useState(filters.competition ?? 'all');
  const [team, setTeam] = useState(filters.team ?? 'all');
  const [from, setFrom] = useState(filters.from ?? '');
  const [to, setTo] = useState(filters.to ?? '');
  const mounted = useRef(false);

  // Adopt server state on navigation (back/forward, shared URL).
  useEffect(() => {
    setType(filters.type);
    setCompetition(filters.competition ?? 'all');
    setTeam(filters.team ?? 'all');
    setFrom(filters.from ?? '');
    setTo(filters.to ?? '');
  }, [filters.type, filters.competition, filters.team, filters.from, filters.to]);

  // Guard against pushing a duplicate URL on mount.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    router.push(
      buildSearchUrl(filters.query, {
        type: type ?? undefined,
        competition: competition === 'all' ? undefined : competition,
        team: team === 'all' ? undefined : team,
        from: from || undefined,
        to: to || undefined,
        page: 1,
      }),
    );
  }, [type, competition, team, from, to, filters.query, router]);

  const hasDates = Boolean(from || to);

  return (
    <section className="search-filters" aria-labelledby="search-filters-heading">
      <h2 id="search-filters-heading" className="search-filters__heading">
        Refine results
      </h2>
      <div className="search-filters__grid">
        <div className="search-filters__field">
          <label htmlFor="filter-type">Content type</label>
          <select
            id="filter-type"
            value={type ?? 'all'}
            onChange={(event) => setType(event.target.value === 'all' ? null : (event.target.value as SearchableType))}
          >
            <option value="all">All types</option>
            {SEARCHABLE_TYPES.map((option) => (
              <option key={option} value={option}>
                {SEARCH_GROUP_LABELS[option]}
              </option>
            ))}
          </select>
        </div>

        {competitions.length > 0 ? (
          <div className="search-filters__field">
            <label htmlFor="filter-competition">Competition</label>
            <select id="filter-competition" value={competition} onChange={(event) => setCompetition(event.target.value)}>
              <option value="all">All competitions</option>
              {competitions.map((option) => (
                <option key={option.slug} value={option.slug}>
                  {sanitizeText(option.name, 60)}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {teams.length > 0 ? (
          <div className="search-filters__field">
            <label htmlFor="filter-team">Team</label>
            <select id="filter-team" value={team} onChange={(event) => setTeam(event.target.value)}>
              <option value="all">All teams</option>
              {teams.map((option) => (
                <option key={option.slug} value={option.slug}>
                  {sanitizeText(option.name, 60)}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="search-filters__field">
          <label htmlFor="filter-from">From date</label>
          <input
            id="filter-from"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>

        <div className="search-filters__field">
          <label htmlFor="filter-to">To date</label>
          <input
            id="filter-to"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
      </div>

      {hasDates ? (
        <p className="search-filters__note" role="status">
          Date filters apply to matches and news.
        </p>
      ) : null}
    </section>
  );
}
