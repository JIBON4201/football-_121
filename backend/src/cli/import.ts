/**
 * Server-side import CLI (administrators/developers only — never HTTP).
 *
 *   npm run import -- --dry-run
 *   npm run import -- --entity teams --entity matches --limit 100
 *   npm run import -- --provider seed --from 2026-08-01 --to 2027-05-31
 *   npm run import -- --competition seed-comp-epl --json
 */
import { config } from '../config';
import { IMPORT_ORDER, runImport, type ImportScope } from '../providers/importService';
import { registerSeedProvider } from '../providers/seed/seedProvider';
import type { SyncEntityType } from '../providers/types';

export interface CliOptions {
  scope: ImportScope;
  json: boolean;
}

const ENTITY_SET = new Set<string>(IMPORT_ORDER);

export function parseArgs(argv: string[]): CliOptions {
  const scope: ImportScope = { provider: 'seed', params: {} };
  const entities: SyncEntityType[] = [];
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    const take = (): string => {
      if (next === undefined || next.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      i += 1;
      return next;
    };
    switch (arg) {
      case '--provider':
        scope.provider = take();
        break;
      case '--data-source':
        scope.dataSourceId = take();
        break;
      case '--entity': {
        const entity = take();
        if (!ENTITY_SET.has(entity)) throw new Error(`Unsupported entity '${entity}'`);
        entities.push(entity as SyncEntityType);
        break;
      }
      case '--dry-run':
        scope.dryRun = true;
        break;
      case '--limit':
        scope.limit = Number(take());
        if (!Number.isInteger(scope.limit) || scope.limit < 1) throw new Error('limit must be a positive integer');
        break;
      case '--batch-size':
        scope.batchSize = Number(take());
        break;
      case '--competition':
        scope.params = { ...scope.params, competitionExternalId: take() };
        break;
      case '--season':
        scope.params = { ...scope.params, seasonExternalId: take() };
        break;
      case '--from':
        scope.params = { ...scope.params, from: take() };
        break;
      case '--to':
        scope.params = { ...scope.params, to: take() };
        break;
      case '--json':
        json = true;
        break;
      default:
        throw new Error(`Unknown argument '${arg}'`);
    }
  }
  if (entities.length > 0) scope.entities = entities;
  return { scope, json };
}

function printHuman(report: Awaited<ReturnType<typeof runImport>>): void {
  console.log(`import ${report.dryRun ? '(dry-run) ' : ''}provider=${report.provider} duration=${report.durationMs}ms`);
  for (const stage of report.stages) {
    console.log(
      `  ${stage.entityType}: ${stage.status} discovered=${stage.discovered} valid=${stage.valid} ` +
        `created=${stage.created} updated=${stage.updated} failed=${stage.failed} conflicts=${stage.conflicts}`,
    );
  }
  if (report.integrity) {
    console.log(
      `  integrity: mappings=${report.integrity.mappings} duplicates=${report.integrity.duplicateMappings}`,
    );
  }
}

export async function main(argv: string[]): Promise<number> {
  // The seed provider carries fixture data; never import it into production.
  if (!config.isProd) registerSeedProvider();
  const { scope, json } = parseArgs(argv);
  if (config.isProd && scope.provider === 'seed') {
    console.error('Refusing to import from the seed provider in production.');
    return 1;
  }
  const report = await runImport(scope);
  if (json) console.log(JSON.stringify(report, null, 2));
  else printHuman(report);
  return report.stages.some((stage) => stage.status === 'failed') ? 1 : 0;
}

const invokedDirectly = (process.argv[1] ?? '').replace(/\\/g, '/').endsWith('src/cli/import.ts');
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : 'Import failed');
      process.exit(1);
    });
}
