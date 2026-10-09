/**
 * Baseline/after measurement for GET /seo/metadata and GET /seo/structured.
 *
 * Counts DB round trips per request (the test fake records every query) and times
 * the request with a simulated per-query network round trip, since the bottleneck
 * is query count and payload size, not CPU.
 *
 * Usage: npx tsx measure-seo-meta.ts <label>
 */
import request from 'supertest';
import { app, installTestEnv } from './tests/helpers';
import { resetCacheStore } from './src/lib/cache';
import { setClientFactories } from './src/lib/supabase';
import type { FakeClient, FakeQueryBuilder } from './tests/fake';

const LABEL = process.argv[2] ?? 'run';
/** Typical remote PostgREST round trip (ms). */
const RTT_MS = Number(process.env.RTT_MS ?? 12);

function pad(n: number): string {
  return String(n).padStart(12, '0');
}

function publishedArticle(id: string, slug: string, title: string, excerpt: string | null = 'A match report excerpt.') {
  return {
    id,
    slug,
    status: 'published',
    published_at: '2026-09-01T10:00:00.000Z',
    updated_at: '2026-09-01T10:00:00.000Z',
    article_type: 'news',
    is_breaking: false,
    is_featured: false,
    title,
    excerpt,
    content: 'Long article body content that should never be fetched for SEO metadata. '.repeat(40),
  };
}

/** Wraps the fake so every query pays one simulated network round trip. */
function latencyClient(fake: FakeClient): unknown {
  return {
    from(table: string): unknown {
      const builder = fake.from(table) as FakeQueryBuilder;
      const original = builder.then.bind(builder);
      (builder as unknown as { then: unknown }).then = (resolve: (value: unknown) => void) => {
        setTimeout(() => original(resolve), RTT_MS);
        return builder;
      };
      return builder;
    },
  };
}

interface RunResult {
  queries: number;
  ms: number;
  status: number;
  bytes: number;
  body: unknown;
}

async function measure(path: string, fake: FakeClient): Promise<RunResult> {
  resetCacheStore();
  fake.queries = [];
  const started = performance.now();
  const res = await request(app).get(path);
  const ms = performance.now() - started;
  return {
    queries: fake.queries.length,
    ms: Math.round(ms),
    status: res.status,
    bytes: JSON.stringify(res.body).length,
    body: res.body,
  };
}

function summarise(label: string, runs: RunResult[]): void {
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  console.log(`[${label}] status=${runs[0].status} queries=${runs.map((r) => r.queries).join(',')} (median ${median(runs.map((r) => r.queries))})`);
  console.log(`[${label}] latency=${runs.map((r) => r.ms).join(',')}ms (median ${median(runs.map((r) => r.ms))}ms, RTT ${RTT_MS}ms/query)`);
  console.log(`[${label}] payload=${runs.map((r) => r.bytes).join(',')} bytes (median ${median(runs.map((r) => r.bytes))})`);
}

async function main(): Promise<void> {
  const { fake } = installTestEnv();
  // A realistic article with a body, plus the relations the resolver walks.
  fake.store.articles!.push(publishedArticle('a0000000-0000-4000-8000-000000000001', 'big-win', 'Big Win'));
  fake.store.article_competitions!.push({ article_id: 'a0000000-0000-4000-8000-000000000001', competition_id: 'ffffffff-ffff-4fff-8fff-fffffffffff1' });
  setClientFactories({ service: () => latencyClient(fake) as never });

  const metadata: RunResult[] = [];
  const structured: RunResult[] = [];
  for (let i = 0; i < 3; i += 1) {
    metadata.push(await measure('/api/v1/seo/metadata?type=news&slug=big-win', fake));
    structured.push(await measure('/api/v1/seo/structured?type=news&slug=big-win', fake));
  }

  summarise('metadata', metadata);
  summarise('structured', structured);

  // Show which tables were touched and with what columns, so select('*') is visible.
  for (const [label, runs] of [['metadata', metadata], ['structured', structured]] as const) {
    const last = runs[runs.length - 1];
    const tables = new Map<string, number>();
    for (const q of fake.queries) tables.set(q.table, (tables.get(q.table) ?? 0) + 1);
    console.log(`[${label}] tables touched: ${JSON.stringify(Object.fromEntries(tables))}`);
    for (const q of fake.queries) {
      const ops = q.ops.map((op) => {
        if (op.op === 'select') return `select(${(op.args as unknown[])[0]})`;
        if (op.op === 'eq') return `eq(${op.args[0]})`;
        if (op.op === 'range') return `range(${op.args[0]},${op.args[1]})`;
        return op.op;
      });
      console.log(`[${label}]   ${q.table}: ${ops.join(' → ')}`);
    }
  }

  const { writeFileSync } = await import('node:fs');
  writeFileSync(
    `C:/Users/Dev/AppData/Local/Temp/opencode/seo-meta-${LABEL}.json`,
    JSON.stringify({ metadata: metadata[0].body, structured: structured[0].body }, null, 2),
  );
  console.log(`[${LABEL}] wrote response snapshots`);
}

void main();
