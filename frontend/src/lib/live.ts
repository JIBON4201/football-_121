import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_CADENCE,
  isStale,
  LIVE_FAILURE_THRESHOLD,
  pollIntervalFor,
  type PollCadenceOptions,
} from '@/lib/live-state';

/**
 * Live-data transport.
 *
 * The backend exposes no streaming transport, so this is controlled polling
 * against the public API only — the frontend never contacts a provider
 * directly, and no provider URL, key or sync metadata is involved.
 *
 * The `LiveSource` seam is kept so a WebSocket or SSE transport can replace
 * polling later without touching any consumer.
 */

export interface LiveSource<T> {
  /** Start emitting; returns an unsubscribe function. */
  subscribe: (listener: (value: T) => void) => () => void;
}

export interface TelemetryEvent {
  event: 'live_update' | 'live_update_failed' | 'live_update_slow' | 'live_stale';
  /** Milliseconds the update took, when known. */
  latencyMs?: number;
  /** Consecutive failures at the time of the event. */
  consecutiveFailures?: number;
  /** How old the data was when staleness was detected. */
  ageMs?: number;
}

export type TelemetrySink = (event: TelemetryEvent) => void;

export interface PollingOptions<T> {
  /**
   * Derives the next interval from the latest payload, so a page holding an
   * in-play match polls faster than an idle one.
   */
  intervalFor?: (value: T | null) => number;
  cadence?: PollCadenceOptions;
  /** Poll immediately on subscribe rather than after the first interval. */
  immediate?: boolean;
  /** Stop requesting entirely once this returns false (e.g. all finished). */
  shouldContinue?: (value: T | null) => boolean;
  /** Receives transport-level telemetry. Never carries content. */
  onTelemetry?: TelemetrySink;
  /** Injected for tests. */
  now?: () => number;
}

export interface PollingValue<T> {
  data: T | null;
  error: Error | null;
  connected: boolean;
  /** Epoch ms of the last successful payload. */
  lastUpdatedAtMs: number | null;
  /** Consecutive failures since the last success. */
  consecutiveFailures: number;
}

function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

export type StreamProtocol = 'websocket' | 'sse';

/**
 * Streaming seam, kept so a future transport drops in without touching any
 * consumer. The backend exposes no stream today, so this fails loudly rather
 * than silently pretending to be connected.
 */
export function createStreamSource<T>(protocol: StreamProtocol, url: string): LiveSource<LivePollingPayload<T>> {
  return {
    subscribe: () => {
      throw new Error(
        `Streaming via ${protocol} (${url}) is not available. Use createPollingSource against the public API.`,
      );
    },
  };
}

/**
 * Adaptive polling source.
 *
 * Safety properties this guarantees, which the tests assert:
 *  - only one request is ever in flight (no duplicate concurrent requests);
 *  - a response that arrives after unsubscribe or after a newer request
 *    started is discarded, so a stale payload can never overwrite a fresh one;
 *  - a hidden tab does not poll, but still wakes up to check;
 *  - `shouldContinue` can stop the loop entirely once nothing is live.
 */
export function createPollingSource<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  options: PollingOptions<T> = {},
): LiveSource<LivePollingPayload<T>> {
  const {
    cadence,
    immediate = true,
    shouldContinue,
    onTelemetry,
    now = () => Date.now(),
  } = options;
  const idleInterval = cadence ? { ...DEFAULT_CADENCE, ...cadence }.idleMs : DEFAULT_CADENCE.idleMs;
  const hiddenInterval = cadence ? { ...DEFAULT_CADENCE, ...cadence }.hiddenCheckMs : DEFAULT_CADENCE.hiddenCheckMs;

  return {
    subscribe(listener: (value: LivePollingPayload<T>) => void): () => void {
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let inFlight: AbortController | null = null;
      let requestSeq = 0;
      let lastUpdatedAtMs: number | null = null;
      let consecutiveFailures = 0;
      let latest: T | null = null;

      const clearTimer = (): void => {
        if (timer) clearTimeout(timer);
        timer = null;
      };

      const schedule = (delay: number): void => {
        clearTimer();
        if (stopped) return;
        timer = setTimeout(() => void tick(), delay);
      };

      const tick = async (): Promise<void> => {
        if (stopped) return;
        // Hidden tabs wait on a slow timer instead of polling: this keeps the
        // page fresh when it is shown again without a background request storm.
        if (isDocumentHidden()) {
          schedule(hiddenInterval);
          return;
        }
        // `null` means nothing has been fetched yet, so a fetch is still
        // allowed: otherwise a page could never load its first payload.
        if (latest !== null && shouldContinue && !shouldContinue(latest)) {
          // Nothing left to watch. Stay quiet until a new subscription starts.
          return;
        }
        // A request is already running: skip this tick rather than stacking.
        if (inFlight) {
          schedule(idleInterval);
          return;
        }

        const seq = requestSeq + 1;
        requestSeq = seq;
        const controller = new AbortController();
        inFlight = controller;
        const startedAt = now();

        try {
          const value = await fetcher(controller.signal);
          // A newer request started, or we unsubscribed while waiting: discard.
          if (stopped || seq !== requestSeq) return;
          inFlight = null;
          latest = value;
          consecutiveFailures = 0;
          lastUpdatedAtMs = now();
          const latencyMs = lastUpdatedAtMs - startedAt;
          onTelemetry?.({ event: 'live_update', latencyMs });
          if (latencyMs > 10_000) onTelemetry?.({ event: 'live_update_slow', latencyMs });
          listener({ data: value, error: null, connected: true, lastUpdatedAtMs, consecutiveFailures });
        } catch (error) {
          if (stopped || seq !== requestSeq) return;
          inFlight = null;
          consecutiveFailures += 1;
          const failure =
            error instanceof Error ? error : new Error('Live update failed');
          // The previous payload is deliberately kept: a temporary failure must
          // not erase the last known good score.
          onTelemetry?.({
            event: 'live_update_failed',
            consecutiveFailures,
          });
          listener({ data: latest, error: failure, connected: true, lastUpdatedAtMs, consecutiveFailures });
        } finally {
          if (inFlight === controller) inFlight = null;
        }

        if (stopped) return;
        const interval = options.intervalFor
          ? options.intervalFor(latest)
          : pollIntervalFor([], cadence);
        schedule(interval);
      };

      if (immediate) void tick();
      else schedule(options.intervalFor ? options.intervalFor(null) : idleInterval);

      return () => {
        stopped = true;
        clearTimer();
        // Abort the in-flight request so it cannot resolve after teardown.
        if (inFlight) {
          inFlight.abort();
          inFlight = null;
        }
        requestSeq += 1;
      };
    },
  };
}

export interface LivePollingPayload<T> {
  data: T | null;
  error: Error | null;
  connected: boolean;
  lastUpdatedAtMs: number | null;
  consecutiveFailures: number;
}

/** What a consumer sees: the payload plus a derived freshness flag. */
export interface LiveViewState<T> extends LivePollingPayload<T> {
  /** True when the newest payload is older than the staleness window. */
  stale: boolean;
}

/**
 * React binding for any LiveSource.
 *
 * Exposes freshness and failure count so the UI can say "delayed" or
 * "temporarily unavailable" rather than pretending stale data is live.
 */
export function useLiveData<T>(
  createSource: () => LiveSource<LivePollingPayload<T>>,
  deps: unknown[] = [],
  options: { now?: () => number } = {},
): LiveViewState<T> {
  const now = options.now ?? (() => Date.now());
  const [state, setState] = useState<LivePollingPayload<T>>({
    data: null,
    error: null,
    connected: false,
    lastUpdatedAtMs: null,
    consecutiveFailures: 0,
  });

  const factoryRef = useRef(createSource);
  factoryRef.current = createSource;
  const depsKey = JSON.stringify(deps);

  const connect = useCallback(() => {
    let unsubscribe: () => void = () => undefined;
    try {
      unsubscribe = factoryRef.current().subscribe((payload) => {
        setState({
          data: payload.data,
          error: payload.error,
          connected: payload.connected,
          lastUpdatedAtMs: payload.lastUpdatedAtMs,
          consecutiveFailures: payload.consecutiveFailures,
        });
      });
    } catch (error) {
      setState({
        data: null,
        error: error as Error,
        connected: false,
        lastUpdatedAtMs: null,
        consecutiveFailures: 0,
      });
    }
    return unsubscribe;
  }, [depsKey]);

  useEffect(() => connect(), [connect]);

  return { ...state, stale: isStale(state.lastUpdatedAtMs, now()) };
}

/** Whether the feed has failed often enough to stop presenting data as live. */
export function isUnavailable(state: { consecutiveFailures: number }): boolean {
  return state.consecutiveFailures >= LIVE_FAILURE_THRESHOLD;
}

export { isStale };
