'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { entityUrl } from '@/config/routes';
import { createDefaultClient } from '@/lib/api-client';
import {
  createPollingSource,
  isUnavailable,
  useLiveData,
  type TelemetryEvent,
} from '@/lib/live';
import {
  freshnessLabel,
  groupLiveByCompetition,
  livePhaseFor,
  pollIntervalFor,
  type LivePhase,
} from '@/lib/live-state';
import { mergeLiveRows, nextResolveBatch, type LiveFeedPayload } from '@/lib/live-feed';
import { toMatchDetails, type MatchListItem } from '@/lib/matches';
import { sanitizeText } from '@/lib/validation';
import { Alert, EmptyState } from '@/components/ui/Feedback';
import { LiveMatchListSkeleton } from '@/components/ui/Skeleton';
import { LiveMatchCard } from '@/components/live/LiveMatchCard';
import type { Match } from '@/types/api';

const LIVE_LIMIT = 24;

type PhaseFilter = 'all' | LivePhase;

const PHASE_FILTERS: Array<{ value: PhaseFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'in_play', label: 'In play' },
  { value: 'break', label: 'On a break' },
  { value: 'halted', label: 'Suspended' },
];

interface LiveFeedProps {
  /** Server-rendered enriched snapshot, so the first paint needs no client fetch. */
  initialItems: MatchListItem[];
  /** Server time at render, used as the clock anchor before the first poll. */
  initialServerTime: string | null;
}

/**
 * Client live feed.
 *
 * Renders an enriched server snapshot immediately, then keeps the score and
 * status current through adaptive polling of the public live endpoint. A
 * temporary failure keeps the last known scores on screen and says so, rather
 * than blanking the page or silently presenting stale numbers as live.
 */
export function LiveFeed({ initialItems, initialServerTime }: LiveFeedProps) {
  const [phaseFilter, setPhaseFilter] = useState<PhaseFilter>('all');
  const [competitionFilter, setCompetitionFilter] = useState<string>('all');
  const [triedSlugs, setTriedSlugs] = useState<Set<string>>(new Set());
  // Extra matches resolved on demand once they appear in the feed.
  const [resolved, setResolved] = useState<MatchListItem[]>([]);
  // Server-anchored "now", advanced locally between polls.
  const [nowMs, setNowMs] = useState(() => Date.parse(initialServerTime ?? '') || Date.now());

  const resolvedRef = useRef(resolved);
  resolvedRef.current = resolved;
  const triedRef = useRef(triedSlugs);
  triedRef.current = triedSlugs;

  const createSource = useCallback(
    () =>
      createPollingSource<LiveFeedPayload>(async (signal) => {
        const client = createDefaultClient();
        const response = await client.get<Match[]>('/matches/live', {
          query: { limit: LIVE_LIMIT },
          signal,
        });
        const payload = mergeLiveRows(
          [...initialItems, ...resolvedRef.current],
          (response.data ?? []).map((match) => ({
            match,
            serverTime: typeof response.meta?.server_time === 'string' ? response.meta.server_time : null,
          })),
        );
        return payload;
      }, {
        // Faster while something is actually being played, and easing off to a
        // slow idle check when the feed is empty — so a match that kicks off
        // while the page is open still appears, without a request storm.
        intervalFor: (value) => pollIntervalFor((value?.items ?? []).map((item) => item.match.status)),
        onTelemetry: (event: TelemetryEvent) => {
          if (typeof window === 'undefined') return;
          window.dispatchEvent(new CustomEvent('live:telemetry', { detail: event }));
        },
      }),
    [initialItems],
  );

  const { data, error, connected, lastUpdatedAtMs, consecutiveFailures, stale } = useLiveData<LiveFeedPayload>(
    createSource,
    [initialItems],
  );

  // Advance the clock locally so the minute readout ticks between polls.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Resolve matches that became live after the page loaded, a few at a time.
  useEffect(() => {
    const unknown = data?.unknownSlugs ?? [];
    if (unknown.length === 0) return;
    const batch = nextResolveBatch(unknown, triedRef.current);
    if (batch.length === 0) return;
    let cancelled = false;
    setTriedSlugs((prev) => {
      const next = new Set(prev);
      for (const slug of batch) next.add(slug);
      return next;
    });
    (async () => {
      const client = createDefaultClient();
      const results = await Promise.all(
        batch.map(async (slug) => {
          try {
            const response = await client.get<unknown>(`/matches/${slug}/details`);
            const details = toMatchDetails(response.data);
            if (!details) return null;
            return {
              match: details.match,
              homeTeam: details.homeTeam,
              awayTeam: details.awayTeam,
              competition: details.competition ?? null,
              venue: details.venue ?? null,
            } satisfies MatchListItem;
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      const found = results.filter((item): item is MatchListItem => item !== null);
      if (found.length > 0) setResolved((prev) => [...prev, ...found]);
    })();
    return () => {
      cancelled = true;
    };
  }, [data?.unknownSlugs]);

  const allItems = useMemo(() => {
    const seen = new Set<string>();
    return [...(data?.items ?? []), ...resolved].filter((item) => {
      if (seen.has(item.match.id)) return false;
      seen.add(item.match.id);
      return true;
    });
  }, [data?.items, resolved]);

  const competitions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of allItems) {
      if (item.competition) seen.set(item.competition.slug, item.competition.name);
    }
    return Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [allItems]);

  const visible = useMemo(
    () =>
      allItems.filter((item) => {
        if (phaseFilter !== 'all' && livePhaseFor(item.match.status) !== phaseFilter) return false;
        if (competitionFilter !== 'all') {
          return item.competition?.slug === competitionFilter;
        }
        return true;
      }),
    [allItems, phaseFilter, competitionFilter],
  );

  const groups = useMemo(() => groupLiveByCompetition(visible), [visible]);

  const unavailable = isUnavailable({ consecutiveFailures });
  const initialLoad = data === null && lastUpdatedAtMs === null && consecutiveFailures === 0;
  // `stale` is recomputed on each render, including every clock tick, so a
  // stalled feed is flagged without a second timer.
  const showStaleBanner = !unavailable && stale;

  if (initialLoad) return <LiveMatchListSkeleton count={4} />;

  if (unavailable) {
    return (
      <Alert tone="error" role="status">
        Live scores are temporarily unavailable. Fixtures and results are still available on the{' '}
        <a href="/matches">matches page</a>.
      </Alert>
    );
  }

  if (allItems.length === 0) {
    return (
      <EmptyState
        title="No live matches right now"
        description="Nothing is in play at the moment. Check today's fixtures or the upcoming schedule."
      />
    );
  }

  return (
    <div className="live-feed" aria-busy={!connected}>
      <div className="live-feed__toolbar">
        <fieldset className="live-feed__filters">
          <legend>Filter live matches</legend>
          <div className="live-feed__filter-group" role="group" aria-label="Filter by match state">
            {PHASE_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                className="live-feed__filter"
                aria-pressed={phaseFilter === filter.value}
                onClick={() => setPhaseFilter(filter.value)}
              >
                {filter.label}
              </button>
            ))}
          </div>
          {competitions.length > 1 ? (
            <div className="live-feed__filter-group">
              <label className="live-feed__select-label" htmlFor="live-competition">
                Competition
              </label>
              <select
                id="live-competition"
                className="live-feed__select"
                value={competitionFilter}
                onChange={(event) => setCompetitionFilter(event.target.value)}
              >
                <option value="all">All competitions</option>
                {competitions.map(([slug, name]) => (
                  <option key={slug} value={slug}>
                    {sanitizeText(name)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </fieldset>
        <p className="live-feed__freshness" data-stale={showStaleBanner} aria-live="polite">
          {showStaleBanner ? 'Scores may be delayed. ' : ''}
          {freshnessLabel(lastUpdatedAtMs, nowMs)}
          {error ? ' — showing the last known scores' : ''}
        </p>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="No matches match that filter"
          description="Try a different state or competition to see the rest of the live action."
        />
      ) : (
        groups.map((group) => (
          <section key={group.key} className="live-feed__group" aria-labelledby={`live-group-${group.key}`}>
            <h2 id={`live-group-${group.key}`} className="live-feed__group-title">
              {group.slug ? <a href={entityUrl('competition', group.slug)}>{sanitizeText(group.name)}</a> : sanitizeText(group.name)}
            </h2>
            <ul className="live-feed__list" aria-label={`${group.name} live matches`}>
              {group.items.map((item) => (
                <li key={item.match.id}>
                  <LiveMatchCard item={item} serverNowMs={nowMs} />
                </li>
              ))}            </ul>
          </section>
        ))
      )}
    </div>
  );
}
