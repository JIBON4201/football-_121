/**
 * Step 40 verification CLI.
 *
 *   npm run verify                       # offline checks + report
 *   npm run verify -- --json             # machine-readable only
 *   npm run verify -- --out ./reports    # also write JSON + Markdown artifacts
 *   npm run verify -- --no-db            # skip database-dependent checks
 *   npm run verify -- --api http://localhost:4000 --site http://localhost:3000
 *
 * Exit code is non-zero when any check FAILs or any BLOCKER finding exists,
 * so CI cannot go green on a broken verification run.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config } from '../config';
import { resolveEnvMode } from '../lib/envRules';
import { checkSiteUrl, runVerification, verdict } from './checks';
import { buildReport, exitCodeFor, renderMarkdown } from './report';

export interface VerifyCliOptions {
  json: boolean;
  markdown: boolean;
  outDir?: string;
  repoRoot: string;
  apiBaseUrl?: string;
  siteBaseUrl?: string;
  mediaIds: string[];
  useDatabase: boolean;
}

export function parseVerifyArgs(argv: string[]): VerifyCliOptions {
  const options: VerifyCliOptions = {
    json: false,
    markdown: true,
    // Default to the repository root (one level above backend/).
    repoRoot: resolve(__dirname, '..', '..', '..'),
    mediaIds: [],
    useDatabase: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const take = (): string => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      i += 1;
      return value;
    };
    switch (arg) {
      case '--json':
        options.json = true;
        options.markdown = false;
        break;
      case '--markdown':
        options.markdown = true;
        break;
      case '--quiet':
        options.markdown = false;
        options.json = false;
        break;
      case '--out':
        options.outDir = resolve(take());
        break;
      case '--repo-root':
        options.repoRoot = resolve(take());
        break;
      case '--api':
        options.apiBaseUrl = take();
        break;
      case '--site':
        options.siteBaseUrl = take();
        break;
      case '--media-id':
        options.mediaIds.push(take());
        break;
      case '--no-db':
        options.useDatabase = false;
        break;
      default:
        throw new Error(`Unknown argument '${arg}'`);
    }
  }
  return options;
}

export async function main(argv: string[]): Promise<number> {
  const options = parseVerifyArgs(argv);

  const results = await runVerification({
    repoRoot: options.repoRoot,
    targets: {
      apiBaseUrl: options.apiBaseUrl,
      siteBaseUrl: options.siteBaseUrl,
      mediaIds: options.mediaIds,
    },
    useDatabase: options.useDatabase,
  });
  results.push(checkSiteUrl());

  const report = buildReport(results, resolveEnvMode(process.env.NODE_ENV));
  const code = exitCodeFor(report);

  if (options.outDir) {
    mkdirSync(options.outDir, { recursive: true });
    const stamp = report.generatedAt.replace(/[:.]/g, '-');
    writeFileSync(join(options.outDir, `verification-${stamp}.json`), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    writeFileSync(join(options.outDir, `verification-${stamp}.md`), renderMarkdown(report), 'utf8');
    // Stable "latest" paths for CI consumption.
    writeFileSync(join(options.outDir, 'verification.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    writeFileSync(join(options.outDir, 'verification.md'), renderMarkdown(report), 'utf8');
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (options.markdown) {
    console.log(renderMarkdown(report));
  } else {
    const summary = verdict(report.checks);
    console.log(
      `verification: ${summary.ok ? 'OK' : 'NOT PRODUCTION-READY'} — ` +
        `${report.totals.pass} pass, ${report.totals.fail} fail, ${report.totals.warn} warn, ` +
        `${report.totals.skipped} unverified, ${report.bySeverity.BLOCKER} blocker findings`,
    );
    for (const blocker of report.blockers) console.log(`  BLOCKER ${blocker}`);
    for (const unverified of report.remainingBlockers) console.log(`  ${unverified}`);
    console.log(`  site: ${config.site.baseUrl}`);
  }

  return code;
}

const invokedDirectly = (process.argv[1] ?? '').replace(/\\/g, '/').endsWith('src/verify/cli.ts');
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : 'Verification failed');
      process.exit(1);
    });
}