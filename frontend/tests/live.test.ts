import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPollingSource, createStreamSource, isUnavailable, type LivePollingPayload, type TelemetryEvent } from '@/lib/live';
import {
  DEFAULT_CADENCE,
  dedupeAndSortEvents,
  elapsedMinutes,
  eventLabel,
  eventMinuteLabel,
  freshnessLabel,
  groupLiveByCompetition,
  isLiveStatus,
  isScheduledStatus,
  isStale,
  isTerminalStatus,
  LIVE_STALE_AFTER_MS,
  liveClockFor,
  livePhaseFor,
  liveTokenFor,
  pollIntervalFor,
  sortLiveMatches,
} from '@/lib/live-state';

/** Collects everything a polling source emits so assertions can inspect it. */
function collect<T>(source: { subscribe: (l: (v: LivePollingPayload<T>) => void) => () => void }) {
  const seen: Array<LivePollingPayload<T>> = [];
  const stop = source.subscribe((value) => seen.push(value));
  return { seen, stop };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('createPollingSource', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('emits a payload carrying freshness metadata on the first tick', async () => {
    const { seen, stop } = collect(createPollingSource(async () => 7));
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toHaveLength(1);
    expect(seen[0].data).toBe(7);
    expect(seen[0].error).toBeNull();
    expect(seen[0].connected).toBe(true);
    expect(seen[0].consecutiveFailures).toBe(0);
    expect(seen[0].lastUpdatedAtMs).not.toBeNull();
    stop();
  });

  it('waits for the interval before polling again', async () => {
    const fetcher = vi.fn(async () => 1);
    const { seen, stop } = collect(
      createPollingSource(fetcher, { intervalFor: () => 10_000 }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(seen).toHaveLength(2);
    stop();
  });

  it('does not start a second request while one is in flight', async () => {
    let release: (value: number) => void = () => undefined;
    const fetcher = vi.fn(() => new Promise<number>((resolve) => (release = resolve)));
    const { stop } = collect(createPollingSource(fetcher, { intervalFor: () => 1_000 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    // Several intervals elapse while the first request is still pending.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    release(1);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(fetcher).toHaveBeenCalledTimes(2);
    stop();
  });

  it('keeps the last good payload when a request fails', async () => {
    let attempt = 0;
    const { seen, stop } = collect(
      createPollingSource(
        async () => {
          attempt += 1;
          if (attempt === 1) return 100;
          throw new Error('network down');
        },
        { intervalFor: () => 1_000 },
      ),
    );
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(seen).toHaveLength(2);
    // The failure must not erase the score the reader was already seeing.
    expect(seen[1].data).toBe(100);
    expect(seen[1].error).toBeInstanceOf(Error);
    expect(seen[1].consecutiveFailures).toBe(1);
    stop();
  });

  it('resets the failure count after a success', async () => {
    let attempt = 0;
    const { seen, stop } = collect(
      createPollingSource(
        async () => {
          attempt += 1;
          if (attempt === 2) throw new Error('blip');
          return attempt;
        },
        { intervalFor: () => 1_000 },
      ),
    );
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_100);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(seen.map((s) => s.consecutiveFailures)).toEqual([0, 1, 0]);
    stop();
  });

  it('discards a response that resolves after unsubscribe', async () => {
    let release: (value: number) => void = () => undefined;
    const { seen, stop } = collect(
      createPollingSource(() => new Promise<number>((resolve) => (release = resolve))),
    );
    await vi.advanceTimersByTimeAsync(0);
    stop();
    release(42);
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toHaveLength(0);
  });

  it('aborts the in-flight request on unsubscribe', async () => {
    // A holder object keeps the signal observable; a plain `let` is narrowed to
    // `null` by control-flow analysis because the write happens in a callback.
    const captured: { signal: AbortSignal | null } = { signal: null };
    const { stop } = collect(
      createPollingSource(
        (signal) =>
          new Promise<number>(() => {
            captured.signal = signal;
          }),
      ),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(captured.signal?.aborted).toBe(false);
    stop();
    expect(captured.signal?.aborted).toBe(true);
  });

  it('stops polling entirely once shouldContinue returns false', async () => {
    const fetcher = vi.fn(async () => ({ status: 'finished' }));
    const { stop } = collect(
      createPollingSource(fetcher, { intervalFor: () => 1_000, shouldContinue: () => false }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    stop();
  });

  it('honours immediate: false by waiting a full interval', async () => {
    const fetcher = vi.fn(async () => 1);
    const { stop } = collect(
      createPollingSource(fetcher, { intervalFor: () => 5_000, immediate: false }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_001);
    expect(fetcher).toHaveBeenCalledTimes(1);
    stop();
  });

  it('emits telemetry without leaking payload content', async () => {
    const events: TelemetryEvent[] = [];
    let attempt = 0;
    const { stop } = collect(
      createPollingSource(
        async () => {
          attempt += 1;
          if (attempt === 1) return 'secret-score-payload';
          throw new Error('down');
        },
        { intervalFor: () => 1_000, onTelemetry: (event) => events.push(event) },
      ),
    );
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(events.map((e) => e.event)).toEqual(['live_update', 'live_update_failed']);
    expect(events[1].consecutiveFailures).toBe(1);
    // Telemetry carries timings and counts only.
    expect(JSON.stringify(events)).not.toContain('secret-score-payload');
    stop();
  });
});

describe('createStreamSource', () => {
  it('fails loudly because no stream transport is available', () => {
    const source = createStreamSource<number>('websocket', 'wss://example/live');
    expect(() => source.subscribe(() => undefined)).toThrow(/not available/i);
  });
});

describe('isUnavailable', () => {
  const base: LivePollingPayload<number> = {
    data: 1,
    error: null,
    connected: true,
    lastUpdatedAtMs: 1,
    consecutiveFailures: 0,
  };
  it('holds off until three consecutive failures', () => {
    expect(isUnavailable({ ...base, consecutiveFailures: 2 })).toBe(false);
    expect(isUnavailable({ ...base, consecutiveFailures: 3 })).toBe(true);
  });
});

describe('status classification', () => {
  it('recognises in-play statuses including suspended', () => {
    for (const status of ['live', 'half_time', 'extra_time', 'penalty_shootout', 'suspended']) {
      expect(isLiveStatus(status)).toBe(true);
    }
  });

  it('never treats a scheduled match as live', () => {
    expect(isLiveStatus('scheduled')).toBe(false);
    expect(isScheduledStatus('scheduled')).toBe(true);
    expect(isScheduledStatus('pre_match')).toBe(true);
    expect(liveTokenFor('scheduled')).toBeNull();
    expect(livePhaseFor('scheduled')).toBeNull();
  });

  it('treats finished and void matches as terminal', () => {
    for (const status of ['finished', 'postponed', 'cancelled', 'abandoned']) {
      expect(isTerminalStatus(status)).toBe(true);
    }
  });

  it('maps statuses to a short token and a full label', () => {
    expect(liveTokenFor('live')).toEqual({ token: 'LIVE', label: 'Live' });
    expect(liveTokenFor('half_time')?.token).toBe('HT');
    expect(liveTokenFor('extra_time')?.token).toBe('ET');
    expect(liveTokenFor('penalty_shootout')?.token).toBe('PEN');
    expect(liveTokenFor('suspended')?.label).toBe('Suspended');
  });

  it('buckets statuses by phase', () => {
    expect(livePhaseFor('live')).toBe('in_play');
    expect(livePhaseFor('extra_time')).toBe('in_play');
    expect(livePhaseFor('half_time')).toBe('break');
    expect(livePhaseFor('penalty_shootout')).toBe('break');
    expect(livePhaseFor('suspended')).toBe('halted');
  });
});

describe('elapsedMinutes', () => {
  const kickoff = '2024-05-01T15:00:00.000Z';

  it('counts whole minutes since kickoff', () => {
    expect(elapsedMinutes(kickoff, Date.parse('2024-05-01T15:45:00.000Z'))).toBe(45);
    expect(elapsedMinutes(kickoff, Date.parse('2024-05-01T15:45:59.000Z'))).toBe(45);
  });

  it('clamps pre-kickoff to zero rather than showing a negative clock', () => {
    expect(elapsedMinutes(kickoff, Date.parse('2024-05-01T14:55:00.000Z'))).toBe(0);
  });

  it('returns null for an unparseable or implausible kickoff', () => {
    expect(elapsedMinutes('not-a-date', Date.now())).toBeNull();
    expect(elapsedMinutes(kickoff, Date.parse('2024-05-01T20:00:00.000Z'))).toBeNull();
  });
});

describe('liveClockFor', () => {
  const kickoff = '2024-05-01T15:00:00.000Z';
  const at67 = Date.parse('2024-05-01T16:07:00.000Z');

  it('shows an explicitly approximate clock while a match is being played', () => {
    const clock = liveClockFor('live', kickoff, at67);
    expect(clock?.label).toBe("67'");
    // The accessible text must not present the value as authoritative.
    expect(clock?.accessible).toMatch(/approximately/i);
  });

  it('never invents a running clock for half time, penalties, suspension or a finished match', () => {
    expect(liveClockFor('half_time', kickoff, at67)).toBeNull();
    expect(liveClockFor('penalty_shootout', kickoff, at67)).toBeNull();
    expect(liveClockFor('suspended', kickoff, at67)).toBeNull();
    expect(liveClockFor('finished', kickoff, at67)).toBeNull();
    expect(liveClockFor('scheduled', kickoff, at67)).toBeNull();
  });

  it('keeps the clock in extra time and says so', () => {
    const clock = liveClockFor('extra_time', kickoff, at67);
    expect(clock?.label).toBe("67'");
    expect(clock?.accessible).toMatch(/extra time/i);
  });
});

describe('freshness', () => {
  it('treats no data as not stale, and old data as stale', () => {
    expect(isStale(null, 10_000)).toBe(false);
    expect(isStale(0, LIVE_STALE_AFTER_MS - 1)).toBe(false);
    expect(isStale(0, LIVE_STALE_AFTER_MS + 1)).toBe(true);
  });

  it('describes freshness without mentioning any provider', () => {
    expect(freshnessLabel(null, 0)).toBe('Not updated yet');
    expect(freshnessLabel(0, 2_000)).toBe('Updated just now');
    expect(freshnessLabel(0, 30_000)).toBe('Updated 30s ago');
    expect(freshnessLabel(0, 180_000)).toBe('Updated 3 min ago');
    expect(freshnessLabel(0, 60_000).toLowerCase()).not.toContain('api');
  });
});

describe('sortLiveMatches', () => {
  const row = (id: string, status: string, scheduled_at: string) => ({ id, status, scheduled_at });

  it('puts in-play matches before breaks and halted matches', () => {
    const sorted = sortLiveMatches([
      row('c', 'suspended', '2024-05-01T15:00:00.000Z'),
      row('b', 'half_time', '2024-05-01T15:00:00.000Z'),
      row('a', 'live', '2024-05-01T15:00:00.000Z'),
    ]);
    expect(sorted.map((r) => r.status)).toEqual(['live', 'half_time', 'suspended']);
  });

  it('orders by kickoff time and falls back to id for equal times', () => {
    const sorted = sortLiveMatches([
      row('z', 'live', '2024-05-01T16:00:00.000Z'),
      row('b', 'live', '2024-05-01T15:00:00.000Z'),
      row('a', 'live', '2024-05-01T15:00:00.000Z'),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(['a', 'b', 'z']);
  });

  it('does not mutate the input', () => {
    const input = [row('b', 'live', '2024-05-01T15:00:00.000Z'), row('a', 'live', '2024-05-01T15:00:00.000Z')];
    sortLiveMatches(input);
    expect(input.map((r) => r.id)).toEqual(['b', 'a']);
  });
});

describe('groupLiveByCompetition', () => {
  const row = (id: string, competition: { name: string; slug: string } | null) => ({ id, competition });

  it('groups by competition and sorts groups by name', () => {
    const groups = groupLiveByCompetition([
      row('1', { name: 'Premier League', slug: 'premier-league' }),
      row('2', { name: 'Champions League', slug: 'champions-league' }),
      row('3', { name: 'Premier League', slug: 'premier-league' }),
    ]);
    expect(groups.map((g) => g.name)).toEqual(['Champions League', 'Premier League']);
    expect(groups[1].items).toHaveLength(2);
    expect(groups[1].slug).toBe('premier-league');
  });

  it('keeps a match with no competition in its own group instead of dropping it', () => {
    const groups = groupLiveByCompetition([row('1', null)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('Competition not recorded');
    expect(groups[0].slug).toBeNull();
    expect(groups[0].items).toHaveLength(1);
  });
});

describe('dedupeAndSortEvents', () => {
  const event = (
    id: string,
    minute: number | null,
    extra_minute: number | null = null,
    side: number | null = 0,
  ) => ({ id, minute, extra_minute, side });

  it('orders chronologically, including added time', () => {
    const sorted = dedupeAndSortEvents([event('c', 90), event('a', 45), event('b', 45, 2)]);
    expect(sorted.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('drops a duplicated event so a correction is not shown twice', () => {
    const sorted = dedupeAndSortEvents([event('a', 12), event('a', 12)]);
    expect(sorted).toHaveLength(1);
  });

  it('is deterministic for identical minutes and sides', () => {
    const sorted = dedupeAndSortEvents([event('b', 30), event('a', 30)]);
    expect(sorted.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('keeps events with an unknown minute rather than dropping them', () => {
    const sorted = dedupeAndSortEvents([event('a', null), event('b', 10)]);
    expect(sorted.map((e) => e.id)).toEqual(['b', 'a']);
  });
});

describe('event labels', () => {
  it('formats minutes including added time', () => {
    expect(eventMinuteLabel(45, 2)).toBe("45+2'");
    expect(eventMinuteLabel(45, null)).toBe("45'");
    expect(eventMinuteLabel(45, 0)).toBe("45'");
    expect(eventMinuteLabel(null, null)).toBeNull();
  });

  it('gives a readable label for known types and a readable fallback', () => {
    expect(eventLabel('yellow_card')).toBe('Yellow card');
    expect(eventLabel('some_future_type')).toBe('some future type');
  });
});

describe('pollIntervalFor', () => {
  it('polls fastest only while a match is actually being played', () => {
    expect(pollIntervalFor(['live'])).toBe(DEFAULT_CADENCE.inPlayMs);
    expect(pollIntervalFor(['extra_time'])).toBe(DEFAULT_CADENCE.inPlayMs);
    expect(pollIntervalFor(['half_time'])).toBe(DEFAULT_CADENCE.breakMs);
    expect(pollIntervalFor(['suspended'])).toBe(DEFAULT_CADENCE.breakMs);
  });

  it('eases off when nothing is live at all', () => {
    expect(pollIntervalFor([])).toBe(DEFAULT_CADENCE.idleMs);
  });

  it('uses the fastest cadence demanded by any live match', () => {
    expect(pollIntervalFor(['half_time', 'live'])).toBe(DEFAULT_CADENCE.inPlayMs);
  });

  it('respects custom cadence values', () => {
    expect(pollIntervalFor(['live'], { inPlayMs: 5_000 })).toBe(5_000);
  });
});
