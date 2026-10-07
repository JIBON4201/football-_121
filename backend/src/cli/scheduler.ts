/**
 * Standalone scheduler process (administrators/operators only).
 *
 *   npm run scheduler              # evaluate every 60s
 *   npm run scheduler -- --interval 30 --once
 *
 * Evaluates due sync_schedules, enforces idempotency/backpressure, and
 * recovers stale jobs. Runs independently of the sync worker process;
 * both may be colocated or deployed separately. SIGTERM/SIGINT stop
 * cleanly between ticks.
 */
import { assertEnvIsSane } from '../lib/envRules';
import { log } from '../lib/logger';
import { serviceClient } from '../lib/supabase';
import { Scheduler } from '../scheduler/scheduler';
import { SupabaseJobQueue } from '../queue/queue';

export interface SchedulerCliOptions {
  intervalMs: number;
  once: boolean;
}

export function parseSchedulerArgs(argv: string[]): SchedulerCliOptions {
  const options: SchedulerCliOptions = { intervalMs: 60_000, once: false };
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case '--interval': {
        const raw = argv[i + 1];
        if (!raw || raw.startsWith('--')) throw new Error('Missing value for --interval');
        const value = Number(raw) * 1000;
        if (!Number.isFinite(value) || value < 10_000) throw new Error('--interval must be >= 10s');
        options.intervalMs = value;
        i += 1;
        break;
      }
      case '--once':
        options.once = true;
        break;
      default:
        throw new Error(`Unknown argument '${argv[i]}'`);
    }
  }
  return options;
}

const invokedDirectly = (process.argv[1] ?? '').replace(/\\/g, '/').endsWith('src/cli/scheduler.ts');
if (invokedDirectly) {
  assertEnvIsSane();
  const options = parseSchedulerArgs(process.argv.slice(2));
  const scheduler = new Scheduler({ queue: new SupabaseJobQueue(serviceClient()) });
  let stopped = false;
  const shutdown = (): void => {
    stopped = true;
    log({ msg: 'scheduler_stopping' });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  const run = async (): Promise<void> => {
    if (stopped) return;
    try {
      const summary = await scheduler.tick();
      log({ msg: 'scheduler_tick', ...summary });
    } catch (error) {
      log({ msg: 'scheduler_tick_failed', error: error instanceof Error ? error.message : 'unknown' });
    }
    if (options.once || stopped) return;
    setTimeout(() => void run(), options.intervalMs);
  };
  log({ msg: 'scheduler_started', intervalMs: options.intervalMs });
  void run();
}
