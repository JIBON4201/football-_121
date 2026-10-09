/**
 * Temporary measurement server (not part of the shipped app).
 *
 * Boots the real Express app against a full-size in-memory dataset and counts
 * every /api/v1 request per route, so page renders can be compared before/after
 * the match-card fan-out fix.
 */
import express from 'express';
import { createApp } from '../src/app';
import { config } from '../src/config';
import { resetCacheStore } from '../src/lib/cache';
import { setClientFactories } from '../src/lib/supabase';
import { buildMeasureClient } from './seed';

interface Counter {
  total: number;
  byPath: Record<string, number>;
  bytes: Record<string, number>;
  detailCalls: number;
  listCalls: number;
  startedAt: number;
  queriesAtReset: number;
}

const fake = buildMeasureClient();
setClientFactories({ anon: () => fake as never, service: () => fake as never });

const counter: Counter = {
  total: 0,
  byPath: {},
  bytes: {},
  detailCalls: 0,
  listCalls: 0,
  startedAt: 0,
  queriesAtReset: 0,
};

const app = createApp();

// Rate limiting would otherwise throttle a 39-request page render.
config.rateLimit.publicMax = 100000;
config.rateLimit.authedMax = 100000;

const counts = express.Router();

counts.post('/reset', (_req, res) => {
  counter.total = 0;
  counter.byPath = {};
  counter.bytes = {};
  counter.detailCalls = 0;
  counter.listCalls = 0;
  counter.startedAt = Date.now();
  // Every measurement starts from a cold service cache, so the reported query
  // count is real work rather than a warm-hit artefact of the previous page.
  resetCacheStore();
  counter.queriesAtReset = fake.queries.length;
  res.json({ ok: true });
});

counts.get('/report', (_req, res) => {
  const entries = Object.entries(counter.byPath)
    .map(([path, n]) => ({ path, n, bytes: counter.bytes[path] ?? 0 }))
    .sort((a, b) => b.n - a.n || a.path.localeCompare(b.path));
  res.json({
    total: counter.total,
    detailCalls: counter.detailCalls,
    listCalls: counter.listCalls,
    totalBytes: Object.values(counter.bytes).reduce((a, b) => a + b, 0),
    dbQueries: fake.queries.length - counter.queriesAtReset,
    windowMs: Date.now() - counter.startedAt,
    entries,
  });
});

const instrumented = express();
instrumented.use((req, res, next) => {
  const path = req.path;
  const isApi = path.startsWith('/api/v1');
  if (!isApi) return next();
  const started = Date.now();
  counter.total += 1;
  if (path.includes('/details')) counter.detailCalls += 1;
  else if (path.includes('/matches')) counter.listCalls += 1;
  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    const text = JSON.stringify(body) ?? '';
    const key = path.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
      .replace(/\/(fc-example|real-sample|club-\d+|[a-z0-9-]+-vs-[a-z0-9-]+-\d{4}-\d{2}-\d{2})\b/gi, '/:slug');
    counter.byPath[key] = (counter.byPath[key] ?? 0) + 1;
    counter.bytes[key] = (counter.bytes[key] ?? 0) + Buffer.byteLength(text);
    process.stdout.write(
      `[measure] ${String(Date.now() - started).padStart(5)}ms ${key} (${Buffer.byteLength(text)}B)\n`,
    );
    return originalJson(body);
  };
  return next();
});

instrumented.use('/__count', counts);
instrumented.use(app);

const port = Number(process.env.MEASURE_PORT ?? 4100);
instrumented.listen(port, () => {
  process.stdout.write(`[measure] listening on ${port}\n`);
  const live = (fake.store.matches ?? []).filter((m) => m.status === 'live').length;
  const finished = (fake.store.matches ?? []).filter((m) => m.status === 'finished').length;
  const future = (fake.store.matches ?? []).filter(
    (m) => typeof m.scheduled_at === 'string' && Date.parse(m.scheduled_at as string) > Date.now(),
  ).length;
  process.stdout.write(
    `[measure] matches=${(fake.store.matches ?? []).length} live=${live} finished=${finished} upcoming=${future}\n`,
  );
});