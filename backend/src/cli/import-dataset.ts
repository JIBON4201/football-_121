/**
 * Dataset import CLI (administrators/developers only — never HTTP).
 *
 *   npm run import:dataset -- --dataset /path/to/football-dataset --dry-run
 *   npm run import:dataset -- --dataset <dir> --phase reference --limit 200
 *   npm run import:dataset -- --dataset <dir> --phase matches --batch-size 500
 *   npm run import:dataset -- --dataset <dir> --live
 *
 * Without --live every run is a dry-run (reads + validates, never writes).
 * Live runs additionally require nothing else outside production; inside
 * production (NODE_ENV=production) --allow-production is mandatory.
 */
import { serviceClient } from '../lib/supabase';
import { DATASET_PHASES, type DatasetPhase } from '../data-import/types';
import { runDatasetImport, type RunnerOptions } from '../data-import/runner';

export interface DatasetCliOptions extends RunnerOptions {
  json: boolean;
}

const PHASE_SET = new Set<string>(DATASET_PHASES);

function take(argv: string[], i: number, arg: string): { value: string; next: number } {
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
  return { value, next: i + 1 };
}

export function parseDatasetArgs(argv: string[]): DatasetCliOptions {
  let datasetDir = process.env.DATASET_DIR ?? '';
  const phases: DatasetPhase[] = [];
  let batchSize = 500;
  let limit: number | undefined;
  let concurrency = 4;
  let live = false;
  let allowProduction = false;
  let force = false;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--dataset': {
        const taken = take(argv, i, arg);
        datasetDir = taken.value;
        i = taken.next;
        break;
      }
      case '--phase': {
        const taken = take(argv, i, arg);
        if (!PHASE_SET.has(taken.value)) {
          throw new Error(`Unknown phase '${taken.value}' (expected one of ${DATASET_PHASES.join(', ')})`);
        }
        phases.push(taken.value as DatasetPhase);
        i = taken.next;
        break;
      }
      case '--batch-size': {
        const taken = take(argv, i, arg);
        batchSize = Number(taken.value);
        if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10000) {
          throw new Error('--batch-size must be an integer between 1 and 10000');
        }
        i = taken.next;
        break;
      }
      case '--limit': {
        const taken = take(argv, i, arg);
        limit = Number(taken.value);
        if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit must be a positive integer');
        i = taken.next;
        break;
      }
      case '--concurrency': {
        const taken = take(argv, i, arg);
        concurrency = Number(taken.value);
        if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) {
          throw new Error('--concurrency must be an integer between 1 and 32');
        }
        i = taken.next;
        break;
      }
      case '--live':
        live = true;
        break;
      case '--allow-production':
        allowProduction = true;
        break;
      case '--force':
        force = true;
        break;
      case '--json':
        json = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument '${arg}' (see --help)`);
    }
  }
  if (!datasetDir) throw new Error('Dataset directory required: pass --dataset <dir> or set DATASET_DIR');
  return {
    datasetDir,
    phases: phases.length > 0 ? [...new Set(phases)] : [...DATASET_PHASES],
    batchSize,
    limit,
    concurrency,
    live,
    allowProduction,
    force,
    json,
  };
}

function printHelp(): void {
  console.log(`dataset import — resumable, idempotent loader for the football data lake

usage:
  npm run import:dataset -- --dataset <dir> [options]

options:
  --dataset <dir>        dataset directory (or DATASET_DIR env)
  --phase <name>         repeatable; one of ${DATASET_PHASES.join(', ')} (default: all, in order)
  --batch-size <n>       rows per checkpoint batch (default 500, max 10000)
  --limit <n>            process at most n rows per file (testing)
  --concurrency <n>      in-batch parallel records (default 4, max 32)
  --live                 enable database writes (without it: dry-run)
  --allow-production     required together with --live when NODE_ENV=production
  --force                ignore completed jobs and reprocess from scratch
  --json                 machine-readable final report
  --help                 this text

safety: without --live nothing is written. Production refuses without
--allow-production. Re-runs resume from stored checkpoints and converge
instead of duplicating (external_entity_ids + update-on-natural-key).`);
}

export async function main(argv: string[]): Promise<number> {
  let options: DatasetCliOptions;
  try {
    options = parseDatasetArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  if (options.live && process.env.NODE_ENV === 'production' && !options.allowProduction) {
    console.error('Refusing live import in production without --allow-production.');
    return 2;
  }
  const client = serviceClient();
  if (!process.env.SUPABASE_URL) {
    console.error('SUPABASE_URL is not set — refusing to run against an unknown database.');
    return 2;
  }
  try {
    const { exitCode } = await runDatasetImport(client, options);
    return exitCode;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Dataset import failed');
    return 1;
  }
}

const invokedDirectly = (process.argv[1] ?? '').replace(/\\/g, '/').endsWith('src/cli/import-dataset.ts');
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : 'Dataset import failed');
      process.exit(1);
    });
}
