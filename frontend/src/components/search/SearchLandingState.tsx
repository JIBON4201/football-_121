'use client';

import { useEffect, useState } from 'react';
import { clearRecentSearches, readRecentSearches, removeRecentSearch } from '@/lib/recent-searches';
import { buildSearchUrl } from '@/lib/search';
import { sanitizeText } from '@/lib/validation';
import { entityUrl, routeUrl } from '@/config/routes';
import { TeamBadge, CompetitionBadge } from '@/components/domain/Badges';

/**
 * Landing state for /search with no query.
 *
 * Deliberately small: guidance, a handful of popular entities drawn from the
 * existing catalog endpoints, and the reader's own local history. There is no
 * recommendation engine here and nothing new is persisted remotely.
 */

export interface PopularEntity {
  slug: string;
  name: string;
  logoUrl?: string | null;
  /** Only meaningful for competitions. */
  countryName?: string | null;
}

interface SearchLandingStateProps {
  popularCompetitions?: PopularEntity[];
  popularTeams?: PopularEntity[];
}

function EntityLink({ entity, kind }: { entity: PopularEntity; kind: 'team' | 'competition' }) {
  const name = sanitizeText(entity.name, 80);
  return (
    <a className="search-landing__entity" href={entityUrl(kind, entity.slug)}>
      {kind === 'team' ? (
        <TeamBadge name={name} logoUrl={entity.logoUrl ?? null} size={28} />
      ) : (
        <CompetitionBadge name={name} logoUrl={entity.logoUrl ?? null} size={28} />
      )}
      <span>{name}</span>
    </a>
  );
}

/** Local-only recent searches, with per-entry and full removal. */
function RecentSearches() {
  const [entries, setEntries] = useState<string[]>([]);

  useEffect(() => {
    setEntries(readRecentSearches());
  }, []);

  if (entries.length === 0) return null;

  return (
    <section className="search-landing__recent" aria-labelledby="recent-searches-heading">
      <div className="search-landing__recent-header">
        <h3 id="recent-searches-heading">Recent searches</h3>
        <button
          type="button"
          className="search-landing__clear"
          onClick={() => {
            clearRecentSearches();
            setEntries([]);
          }}
        >
          Clear all
        </button>
      </div>
      <p className="search-landing__note">Stored only in this browser and never sent to our servers.</p>
      <ul className="search-landing__recent-list">
        {entries.map((entry) => (
          <li key={entry.toLowerCase()}>
            <a href={buildSearchUrl(entry)}>{sanitizeText(entry, 80)}</a>
            <button
              type="button"
              className="search-landing__remove"
              onClick={() => {
                setEntries(removeRecentSearch(entry));
              }}
            >
              <span aria-hidden="true">&times;</span>
              <span className="visually-hidden">{`Remove ${sanitizeText(entry, 40)} from recent searches`}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SearchLandingState({ popularCompetitions = [], popularTeams = [] }: SearchLandingStateProps) {
  return (
    <div className="search-landing">
      <section className="search-landing__guide" aria-labelledby="search-guide-heading">
        <h2 id="search-guide-heading">Search the whole platform</h2>
        <p>
          One search covers every team, player, competition, match and news story. Results are ordered by relevance,
          exactly as our search index ranks them.
        </p>
        <ul className="search-landing__tips">
          <li>Search a team name, a player, or a competition.</li>
          <li>Filter results by content type or date once you have a query.</li>
          <li>Press <kbd>/</kbd> from anywhere to jump straight to the search field.</li>
        </ul>
      </section>

      {popularCompetitions.length > 0 ? (
        <section className="search-landing__group" aria-labelledby="popular-competitions-heading">
          <h3 id="popular-competitions-heading">Popular competitions</h3>
          <ul className="search-landing__entities">
            {popularCompetitions.map((entity) => (
              <li key={entity.slug}>
                <EntityLink entity={entity} kind="competition" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {popularTeams.length > 0 ? (
        <section className="search-landing__group" aria-labelledby="popular-teams-heading">
          <h3 id="popular-teams-heading">Popular teams</h3>
          <ul className="search-landing__entities">
            {popularTeams.map((entity) => (
              <li key={entity.slug}>
                <EntityLink entity={entity} kind="team" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <RecentSearches />

      <nav className="search-landing__sections" aria-label="Browse football sections">
        <h3>Or browse</h3>
        <ul>
          <li>
            <a href={routeUrl('news')}>Latest news</a>
          </li>
          <li>
            <a href={routeUrl('matches')}>All matches</a>
          </li>
          <li>
            <a href={routeUrl('live')}>Live scores</a>
          </li>
          <li>
            <a href={routeUrl('teams')}>Teams</a>
          </li>
          <li>
            <a href={routeUrl('players')}>Players</a>
          </li>
          <li>
            <a href={routeUrl('competitions')}>Competitions</a>
          </li>
        </ul>
      </nav>
    </div>
  );
}
