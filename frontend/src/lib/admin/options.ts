/**
 * Real, read-only option lists for relationship selects. **Server-only.**
 *
 * Every dropdown in the Control Center is populated from a live API: public feeds
 * where one exists (cheaper, RLS-scoped, already tagged for the public site's
 * cache) and admin reads for entities with no public route.
 *
 * This previously hand-rolled its own `fetch` + envelope parsing, duplicated in
 * three places, and cached relationship data for an hour with no tags — so a team
 * created in the admin took up to 3600s to appear in a match form.
 *
 * Client components must not import this module: it reaches `admin-session` →
 * `next/headers`. Take `OptionRow` from `./options-shared` instead.
 */
import { fetchOptionList } from './resource';
import type { OptionRow } from './options-shared';

export type { OptionRow };

export const fetchOptionTeams = (): Promise<OptionRow[]> =>
  fetchOptionList({ kind: 'public', path: '/teams?limit=100' }, (row) => (typeof row.name === 'string' ? row.name : ''));

export const fetchOptionCompetitions = (): Promise<OptionRow[]> =>
  fetchOptionList({ kind: 'public', path: '/competitions?limit=100' }, (row) =>
    typeof row.name === 'string' ? row.name : '',
  );

export const fetchOptionPlayers = (): Promise<OptionRow[]> =>
  fetchOptionList({ kind: 'public', path: '/players?limit=100' }, (row) =>
    typeof row.display_name === 'string'
      ? row.display_name
      : typeof row.full_name === 'string'
        ? row.full_name
        : typeof row.name === 'string'
          ? row.name
          : '',
  );

/** Transfer windows have a public read endpoint, so they use it. */
export const fetchOptionWindows = (): Promise<OptionRow[]> =>
  fetchOptionList({ kind: 'public', path: '/transfers/windows' }, (row) => (typeof row.name === 'string' ? row.name : ''));

/** Seasons and venues have no public read endpoint, so they use admin reads. */
export const fetchOptionSeasons = (): Promise<OptionRow[]> =>
  fetchOptionList({ kind: 'admin', path: '/admin/seasons' }, (row) => (typeof row.name === 'string' ? row.name : ''));

export const fetchOptionVenues = (): Promise<OptionRow[]> =>
  fetchOptionList({ kind: 'admin', path: '/admin/venues' }, (row) => (typeof row.name === 'string' ? row.name : ''));

export const fetchOptionCountries = (): Promise<OptionRow[]> =>
  fetchOptionList({ kind: 'public', path: '/countries?limit=100' }, (row) => (typeof row.name === 'string' ? row.name : ''));