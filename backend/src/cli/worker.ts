/**
 * Background sync worker process (administrators/operators only).
 *
 *   npm run worker                      # poll every 2s, 120s leases
 *   npm run worker -- --poll 5000 --lease 60000 --provider-interval 1000
 *
 * The worker claims durable sync_jobs rows, executes the existing
 * import/sync services, and reports back to the same rows. SIGTERM/SIGINT
 * trigger graceful shutdown: no new claims, active work finishes within
 * the shutdown timeout, otherwise the lease is released for recovery.
 */
import { config } from '../config';
import { assertEnvIsSane } from '../lib/envRules';
import { log } from '../lib/logger';
import { serviceClient } from '../lib/supabase';
import { registerSeedProvider } from '../providers/seed/seedProvider';
import { SupabaseJobQueue } from '../queue/queue';
import { SyncWorker } from '../queue/worker';

export interface WorkerCliOptions {
  pollIntervalMs: number;
  leaseMs: number;
  providerMinIntervalMs: number;
  shutdownTimeoutMs: number;
}

export function parseWorkerArgs(argv: string[]): WorkerCliOptions {
  const options: WorkerCliOptions = {
    pollIntervalMs: 2000,
    leaseMs: 120_000,
    providerMinIntervalMs: 0,
    shutdownTimeoutMs: 60_000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const take = (flag: string): number => {
      const raw = argv[i + 1];
      if (raw === undefined || raw.startsWith('--')) throw new Error(`Missing value for ${flag}`);
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid value for ${flag}`);
      i += 1;
      return value;
    };
    switch (argv[i]) {
      case '--poll':
        options.pollIntervalMs = take('--poll');
        break;
      case '--lease':
        options.leaseMs = take('--lease');
        break;
      case '--provider-interval':
        options.providerMinIntervalMs = take('--provider-interval');
        break;
      case '--shutdown-timeout':
        options.shutdownTimeoutMs = take('--shutdown-timeout');
        break;
      default:
        throw new Error(`Unknown argument '${argv[i]}'`);
    }
  }
  if (options.leaseMs < 10_000) throw new Error('Lease must be at least 10s');
  return options;
}

const invokedDirectly = (process.argv[1] ?? '').replace(/\\/g, '/').endsWith('src/cli/worker.ts');
if (invokedDirectly) {
  assertEnvIsSane();
  // Production must never sync fixture data. Only the real provider adapters
  // are eligible there, so the seed/mock provider stays unregistered.
  if (!config.isProd) registerSeedProvider();
  const options = parseWorkerArgs(process.argv.slice(2));
  const worker = new SyncWorker({
    queue: new SupabaseJobQueue(serviceClient()),
    pollIntervalMs: options.pollIntervalMs,
    leaseMs: options.leaseMs,
    providerMinIntervalMs: options.providerMinIntervalMs,
    shutdownTimeoutMs: options.shutdownTimeoutMs,
  });
  worker.start();
  log({ msg: 'worker_process_started', workerId: worker.workerId });
}
