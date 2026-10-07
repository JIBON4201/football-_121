'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { MATCHES_DEFAULT_LIMIT, matchesQueryToSearch, type AdminMatchesQuery } from '@/lib/admin/match-query';
import type { OptionRow } from '@/lib/admin/options-shared';
import { MATCH_STATUSES } from '@/types/api';

interface MatchesFiltersProps {
  query: AdminMatchesQuery;
  competitions: OptionRow[];
  seasons: OptionRow[];
  teams: OptionRow[];
}

/** Filter/sort form: navigates to the list route with new query params. */
export function MatchesFilters({ query, competitions, seasons, teams }: MatchesFiltersProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next: AdminMatchesQuery = {
      page: 1,
      limit: MATCHES_DEFAULT_LIMIT,
      q: String(data.get('q') ?? '').trim() || undefined,
      status: String(data.get('status') ?? '') || undefined,
      competitionId: String(data.get('competitionId') ?? '') || undefined,
      seasonId: String(data.get('seasonId') ?? '') || undefined,
      teamId: String(data.get('teamId') ?? '') || undefined,
      from: String(data.get('from') ?? '') || undefined,
      to: String(data.get('to') ?? '') || undefined,
      sort: String(data.get('sort') ?? '') || undefined,
    } as AdminMatchesQuery;
    startTransition(() => router.push(`/control-center/matches?${matchesQueryToSearch(next).toString()}`));
  };

  return (
    <form className="cc-filters" onSubmit={handleSubmit} aria-label="Match filters">
      <div className="cc-filters__row">
        <div className="cc-field cc-filters__search">
          <label htmlFor="m-q">Search by ID</label>
          <input id="m-q" name="q" type="search" defaultValue={query.q ?? ''} placeholder="Match ID" maxLength={100} />
        </div>
        <div className="cc-field">
          <label htmlFor="m-f-status">Status</label>
          <select id="m-f-status" name="status" defaultValue={query.status ?? ''}>
            <option value="">All</option>
            {MATCH_STATUSES.map((s) => (
              <option key={s} value={s}>{s.replace('_', ' ')}</option>
            ))}
          </select>
        </div>
        <div className="cc-field">
          <label htmlFor="m-f-comp">Competition</label>
          <select id="m-f-comp" name="competitionId" defaultValue={query.competitionId ?? ''}>
            <option value="">All</option>
            {competitions.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </div>
        <div className="cc-field">
          <label htmlFor="m-f-season">Season</label>
          <select id="m-f-season" name="seasonId" defaultValue={query.seasonId ?? ''}>
            <option value="">All</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>
        <div className="cc-field">
          <label htmlFor="m-f-team">Involving team</label>
          <select id="m-f-team" name="teamId" defaultValue={query.teamId ?? ''}>
            <option value="">Any</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>
        <div className="cc-field">
          <label htmlFor="m-f-from">From date</label>
          <input id="m-f-from" name="from" type="date" defaultValue={query.from ?? ''} />
        </div>
        <div className="cc-field">
          <label htmlFor="m-f-to">To date</label>
          <input id="m-f-to" name="to" type="date" defaultValue={query.to ?? ''} />
        </div>
        <div className="cc-field">
          <label htmlFor="m-f-sort">Order</label>
          <select id="m-f-sort" name="sort" defaultValue={query.sort ?? 'desc'}>
            <option value="desc">Newest first</option>
            <option value="asc">Oldest first</option>
          </select>
        </div>
      </div>
      <div className="cc-filters__actions">
        <button type="submit" className="cc-button cc-button--primary" disabled={pending} aria-busy={pending}>
          {pending ? 'Applying…' : 'Apply filters'}
        </button>
        <Link href="/control-center/matches" className="cc-button cc-button--ghost">Reset</Link>
        <RefreshButton />
      </div>
    </form>
  );
}

function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button type="button" className="cc-button cc-button--ghost" disabled={pending} aria-busy={pending} onClick={() => startTransition(() => router.refresh())}>
      {pending ? 'Refreshing…' : 'Refresh'}
    </button>
  );
}
