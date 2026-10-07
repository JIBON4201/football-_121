'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { liveClockFor, livePhaseFor, liveTokenFor, pollIntervalFor } from '@/lib/live-state';

interface LiveMatchBannerProps {
  status: string;
  scheduledAt: string;
  /** Server time at render, so the first clock reading is server-anchored. */
  serverTime: string;
}

/**
 * The App Router context is absent when this component is rendered in
 * isolation (unit tests, a bare server render). The banner still has a useful
 * static state to show, so a missing router degrades to "no auto-revalidation"
 * rather than throwing. The hook call itself always happens, so hook order
 * stays stable across renders.
 */
function useOptionalRouter(): ReturnType<typeof useRouter> | null {
  try {
    return useRouter();
  } catch {
    return null;
  }
}

/**
 * Live banner for a match page.
 *
 * Two jobs:
 *  1. show the honest state — a real status token, plus an explicitly
 *     approximate minute readout that only appears where a running clock is
 *     truthful (in play, including extra time);
 *  2. keep the server-rendered page current by revalidating the route on an
 *     adaptive interval, pausing while the tab is hidden and stopping entirely
 *     once the match is no longer in progress.
 *
 * It never invents a clock for half time, penalties or suspension, and it never
 * computes a score.
 */
export function LiveMatchBanner({ status, scheduledAt, serverTime }: LiveMatchBannerProps) {
  const router = useOptionalRouter();
  const [nowMs, setNowMs] = useState(() => Date.parse(serverTime) || Date.now());
  const token = liveTokenFor(status);
  const phase = livePhaseFor(status);
  const clock = liveClockFor(status, scheduledAt, nowMs);

  // The clock advances locally between revalidations so it does not look frozen.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (phase === null || router === null) return;
    const interval = pollIntervalFor([status]);
    const id = setInterval(() => {
      // A hidden tab does not revalidate; the router refresh happens on return.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      router.refresh();
    }, interval);
    return () => clearInterval(id);
  }, [phase, status, router]);

  if (token === null) return null;

  return (
    <section className="live-banner" data-status={status} aria-labelledby="live-banner-heading">
      <h2 id="live-banner-heading" className="visually-hidden">
        Live match updates
      </h2>
      <p className="live-banner__state">
        <span className="live-banner__token" data-status={status}>
          {token.token}
        </span>
        <span className="live-banner__label">{token.label}</span>
        {clock ? (
          <span className="live-banner__clock" aria-label={clock.accessible}>
            <span aria-hidden="true">{clock.label}</span>
          </span>
        ) : null}
      </p>
      <p className="live-banner__note">
        {clock
          ? 'The minute shown is approximate, based on the scheduled kickoff time.'
          : 'Scores and events update automatically.'}
      </p>
    </section>
  );
}
