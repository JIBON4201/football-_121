'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { TRANSFERS_DEFAULT_LIMIT, transfersQueryToSearch, type AdminTransfersQuery } from '@/lib/admin/transfer-query';
import type { OptionRow } from '@/lib/admin/options-shared';
import { ADMIN_TRANSFER_STATUSES } from '@/types/api';

interface TransferFiltersProps {
  query: AdminTransfersQuery;
  players: OptionRow[];
  teams: OptionRow[];
  windows: OptionRow[];
  seasons: OptionRow[];
}

/** Filter/sort form: navigates to the list route with the new query params. */
export function TransferFilters({ query, players, teams, windows, seasons }: TransferFiltersProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next: AdminTransfersQuery = {
      page: 1,
      limit: TRANSFERS_DEFAULT_LIMIT,
      q: String(data.get('q') ?? '').trim() || undefined,
      status: String(data.get('status') ?? '') || undefined,
      playerId: String(data.get('playerId') ?? '') || undefined,
      fromTeamId: String(data.get('fromTeamId') ?? '') || undefined,
      toTeamId: String(data.get('toTeamId') ?? '') || undefined,
      windowId: String(data.get('windowId') ?? '') || undefined,
      seasonId: String(data.get('seasonId') ?? '') || undefined,
      sort: (String(data.get('sort') ?? '') || undefined) as AdminTransfersQuery['sort'],
      sortField: (String(data.get('sortField') ?? '') || undefined) as AdminTransfersQuery['sortField'],
    };
    startTransition(() => router.push(`/control-center/transfers?${transfersQueryToSearch(next).toString()}`));
  };

  return (
    <form className="cc-filters" onSubmit={handleSubmit} aria-label="Transfer filters">
      <div className="cc-filters__row">
        <div className="cc-field cc-filters__search">
          <label htmlFor="t-q">Search by ID</label>
          <input id="t-q" name="q" type="search" defaultValue={query.q ?? ''} placeholder="Transfer ID" maxLength={100} />
        </div>
        <div className="cc-field">
          <label htmlFor="t-f-status">Status</label>
          <select id="t-f-status" name="status" defaultValue={query.status ?? ''}>
            <option value="">All</option>
            {ADMIN_TRANSFER_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="cc-field">
          <label htmlFor="t-f-player">Player</label>
          <select id="t-f-player" name="playerId" defaultValue={query.playerId ?? ''}>
            <option value="">All</option>
            {players.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>
        <div className="cc-field">
          <label htmlFor="t-f-from">From team</label>
          <select id="t-f-from" name="fromTeamId" defaultValue={query.fromTeamId ?? ''}>
            <option value="">All</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>
        <div className="cc-field">
          <label htmlFor="t-f-to">To team</label>
          <select id="t-f-to" name="toTeamId" defaultValue={query.toTeamId ?? ''}>
            <option value="">All</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>
        <div className="cc-field">
          <label htmlFor="t-f-window">Window</label>
          <select id="t-f-window" name="windowId" defaultValue={query.windowId ?? ''}>
            <option value="">All</option>
            {windows.map((w) => (
              <option key={w.id} value={w.id}>{w.label}</option>
            ))}
          </select>
        </div>
        <div className="cc-field">
          <label htmlFor="t-f-season">Season</label>
          <select id="t-f-season" name="seasonId" defaultValue={query.seasonId ?? ''}>
            <option value="">All</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>
        <div className="cc-field">
          <label htmlFor="t-f-sortfield">Sort by</label>
          <select id="t-f-sortfield" name="sortField" defaultValue={query.sortField ?? 'effective_date'}>
            <option value="effective_date">Effective date</option>
            <option value="announcement_date">Announcement</option>
          </select>
        </div>
        <div className="cc-field">
          <label htmlFor="t-f-order">Order</label>
          <select id="t-f-order" name="sort" defaultValue={query.sort ?? 'desc'}>
            <option value="desc">Newest first</option>
            <option value="asc">Oldest first</option>
          </select>
        </div>
      </div>
      <div className="cc-filters__actions">
        <button type="submit" className="cc-button cc-button--primary" disabled={pending} aria-busy={pending}>
          {pending ? 'Applying…' : 'Apply filters'}
        </button>
        <Link href="/control-center/transfers" className="cc-button cc-button--ghost">Reset</Link>
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
