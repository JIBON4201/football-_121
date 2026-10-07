/* Minimal in-memory PostgREST-style fake supporting exactly the query
   surface used by repositories: select/eq/in/gte/lte/ilike/or/not/
   order/range/maybeSingle. Records every op for assertion. */

export interface Op {
  op: string;
  args: unknown[];
}

function matchIlike(value: unknown, pattern: string): boolean {
  const term = String(pattern).replace(/^%+|%+$/g, '').toLowerCase();
  return String(value ?? '').toLowerCase().includes(term);
}

interface OrCondition {
  col: string;
  oper: string;
  val: string;
}

function parseOrCondition(cond: string): OrCondition | null {
  const match = cond.match(/^([^.]+)\.(eq|neq|ilike|like)\.(.*)$/);
  if (!match) return null;
  return { col: match[1], oper: match[2], val: match[3] };
}

let fakeIdCounter = 0;

function nextFakeId(): string {
  fakeIdCounter += 1;
  return `00000000-0000-4000-8000-${String(fakeIdCounter).padStart(12, '0')}`;
}

export class FakeQueryBuilder {
  ops: Op[] = [];
  private single = false;
  private orders: Array<{ col: string; asc: boolean }> = [];
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private writeMode: 'insert' | 'upsert' | 'update' | 'delete' | null = null;
  private written: Record<string, unknown>[] = [];
  private pendingUpdate: Record<string, unknown> | null = null;

  constructor(
    readonly table: string,
    private readonly rows: Record<string, unknown>[],
    private readonly fail: boolean,
  ) {}

  select(...args: unknown[]): this {
    this.ops.push({ op: 'select', args });
    return this;
  }
  eq(col: string, val: unknown): this {
    this.ops.push({ op: 'eq', args: [col, val] });
    return this;
  }
  in(col: string, vals: unknown[]): this {
    this.ops.push({ op: 'in', args: [col, vals] });
    return this;
  }
  gte(col: string, val: unknown): this {
    this.ops.push({ op: 'gte', args: [col, val] });
    return this;
  }
  lte(col: string, val: unknown): this {
    this.ops.push({ op: 'lte', args: [col, val] });
    return this;
  }
  ilike(col: string, pattern: string): this {
    this.ops.push({ op: 'ilike', args: [col, pattern] });
    return this;
  }
  or(expr: string): this {
    this.ops.push({ op: 'or', args: [expr] });
    return this;
  }
  not(col: string, oper: string, val: unknown): this {
    this.ops.push({ op: 'not', args: [col, oper, val] });
    return this;
  }
  contains(col: string, val: unknown): this {
    this.ops.push({ op: 'contains', args: [col, val] });
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.orders.push({ col, asc: opts?.ascending ?? false });
    this.ops.push({ op: 'order', args: [col, opts] });
    return this;
  }
  range(from: number, to: number): this {
    this.rangeFrom = from;
    this.rangeTo = to;
    this.ops.push({ op: 'range', args: [from, to] });
    return this;
  }
  /**
   * PostgREST `limit=n` is equivalent to `range(0, n - 1)`. Step 41 hardened
   * every list query with an explicit bound, so the fake must model `limit`
   * or those chains silently fail.
   */
  limit(count: number): this {
    return this.range(0, Math.max(0, Math.floor(count) - 1));
  }
  single(): this {
    this.single = true;
    this.ops.push({ op: 'single', args: [] });
    return this;
  }
  maybeSingle(): this {
    this.single = true;
    this.ops.push({ op: 'maybeSingle', args: [] });
    return this;
  }
  insert(rows: unknown): this {
    const list = (Array.isArray(rows) ? rows : [rows]) as Record<string, unknown>[];
    this.written = list.map((row) => {
      const stored = { ...row };
      if (stored.id === undefined) stored.id = nextFakeId();
      this.rows.push(stored);
      return stored;
    });
    this.writeMode = 'insert';
    this.ops.push({ op: 'insert', args: [rows] });
    return this;
  }
  upsert(rows: unknown, opts?: { onConflict?: string }): this {
    const list = (Array.isArray(rows) ? rows : [rows]) as Record<string, unknown>[];
    const cols = (opts?.onConflict ?? '')
      .split(',')
      .map((col) => col.trim())
      .filter(Boolean);
    this.written = list.map((row) => {
      const stored = { ...row };
      if (stored.id === undefined) stored.id = nextFakeId();
      const existing =
        cols.length > 0
          ? this.rows.find((candidate) => cols.every((col) => candidate[col] === stored[col]))
          : undefined;
      if (existing) {
        Object.assign(existing, stored);
        return existing;
      }
      this.rows.push(stored);
      return stored;
    });
    this.writeMode = 'upsert';
    this.ops.push({ op: 'upsert', args: [rows, opts] });
    return this;
  }
  update(values: Record<string, unknown>): this {
    this.pendingUpdate = values;
    this.writeMode = 'update';
    this.ops.push({ op: 'update', args: [values] });
    return this;
  }
  delete(): this {
    this.writeMode = 'delete';
    this.ops.push({ op: 'delete', args: [] });
    return this;
  }

  private applyFilters(rows: Record<string, unknown>[]): Record<string, unknown>[] {
    let out = [...rows];
    for (const { op, args } of this.ops) {
      if (op === 'eq') {
        out = out.filter((r) => r[args[0] as string] === args[1]);
      } else if (op === 'in') {
        out = out.filter((r) => (args[1] as unknown[]).includes(r[args[0] as string]));
      } else if (op === 'gte' || op === 'lte') {
        // timestamptz semantics: compare chronologically when both sides parse as dates.
        const target = args[1] as unknown;
        const targetTime = typeof target === 'string' ? Date.parse(target) : NaN;
        out = out.filter((r) => {
          const value = r[args[0] as string] as unknown;
          if (!Number.isNaN(targetTime) && typeof value === 'string') {
            const valueTime = Date.parse(value);
            if (!Number.isNaN(valueTime)) {
              return op === 'gte' ? valueTime >= targetTime : valueTime <= targetTime;
            }
          }
          return op === 'gte'
            ? (value as number | string) >= (target as never)
            : (value as number | string) <= (target as never);
        });
      } else if (op === 'ilike') {
        out = out.filter((r) => matchIlike(r[args[0] as string], args[1] as string));
      } else if (op === 'not' && args[1] === 'is' && args[2] === null) {
        out = out.filter((r) => r[args[0] as string] !== null && r[args[0] as string] !== undefined);
      } else if (op === 'contains') {
        const wanted = args[1] as Record<string, unknown>;
        out = out.filter((r) => {
          const actual = r[args[0] as string] as Record<string, unknown> | null;
          if (!actual || typeof actual !== 'object') return false;
          return Object.entries(wanted).every(
            ([key, value]) => JSON.stringify(actual[key]) === JSON.stringify(value),
          );
        });
      } else if (op === 'or') {
        const conds = String(args[0])
          .split(',')
          .map(parseOrCondition)
          .filter((c): c is OrCondition => c !== null);
        out = out.filter((r) =>
          conds.some((c) =>
            c.oper === 'eq' || c.oper === 'neq'
              ? String(r[c.col]) === c.val
              : matchIlike(r[c.col], c.val),
          ),
        );
      }
    }
    return out;
  }

  then(resolve: (value: unknown) => void): unknown {
    if (this.fail) {
      resolve({ data: null, error: { message: '(fake) connection failed' }, count: null });
      return undefined;
    }
    if (this.writeMode === 'insert' || this.writeMode === 'upsert') {
      resolve({ data: this.written, error: null });
      return undefined;
    }
    const filtered = this.applyFilters(this.rows);
    if (this.writeMode === 'update' && this.pendingUpdate) {
      for (const row of filtered) Object.assign(row, this.pendingUpdate);
      resolve({ data: filtered, error: null });
      return undefined;
    }
    if (this.writeMode === 'delete') {
      for (const row of filtered) {
        const index = this.rows.indexOf(row);
        if (index >= 0) this.rows.splice(index, 1);
      }
      resolve({ data: filtered, error: null });
      return undefined;
    }
    if (this.orders.length > 0) {
      const orders = this.orders;
      filtered.sort((a, b) => {
        for (const { col, asc } of orders) {
          const av = (a[col] ?? '') as string | number;
          const bv = (b[col] ?? '') as string | number;
          if (av === bv) continue;
          return (av > bv ? 1 : -1) * (asc ? 1 : -1);
        }
        return 0;
      });
    }
    if (this.single) {
      resolve({ data: filtered[0] ?? null, error: null });
      return undefined;
    }
    const total = filtered.length;
    const paged =
      this.rangeFrom !== null ? filtered.slice(this.rangeFrom, (this.rangeTo ?? total - 1) + 1) : filtered;
    resolve({ data: paged, error: null, count: total });
    return undefined;
  }
}

export type FakeStore = Record<string, Record<string, unknown>[]>;

export function seedStore(): FakeStore {
  return {
    countries: [{ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', slug: 'england', name: 'England', code: 'ENG' }],
    data_sources: [],
    external_entity_ids: [],
    sync_jobs: [],
    sync_errors: [],
    competitions: [
      {
        id: 'ffffffff-ffff-4fff-8fff-fffffffffff1',
        slug: 'premier-league',
        name: 'Premier League',
        short_name: 'EPL',
        country_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
        is_active: true,
      },
    ],
    teams: [
      { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', slug: 'fc-example', name: 'FC Example', short_name: 'FCE', country_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', is_active: true },
      { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', slug: 'real-sample', name: 'Real Sample', short_name: 'RSM', country_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', is_active: true },
    ],
    players: [
      {
        id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
        slug: 'john-doe',
        display_name: 'John Doe',
        first_name: 'John',
        last_name: 'Doe',
        position: 'Forward',
        nationality_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
      },
    ],
    matches: [
      {
        id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
        slug: 'fc-example-vs-real-sample',
        status: 'scheduled',
        scheduled_at: '2030-02-01T15:00:00.000Z',
        competition_id: 'ffffffff-ffff-4fff-8fff-fffffffffff1',
        season_id: '44444444-4444-4444-8444-444444444444',
        venue_id: 'v1',
        home_team_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
        away_team_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
      },
      {
        id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2',
        slug: 'real-sample-vs-fc-example',
        status: 'finished',
        scheduled_at: '2020-02-01T15:00:00.000Z',
        competition_id: 'ffffffff-ffff-4fff-8fff-fffffffffff1',
        season_id: '44444444-4444-4444-8444-444444444444',
        venue_id: 'v1',
        home_team_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
        away_team_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
        home_score: 2,
        away_score: 1,
      },
    ],
    venues: [{ id: 'v1', slug: 'arena', name: 'Arena', city: 'London', country_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', capacity: 60000 }],
    seasons: [
      {
        id: '44444444-4444-4444-8444-444444444444',
        competition_id: 'ffffffff-ffff-4fff-8fff-fffffffffff1',
        name: '2026/27',
        start_date: '2026-08-01',
        end_date: '2027-05-31',
        is_current: true,
      },
    ],
    match_events: [
      { id: 'e1', match_id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', team_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', player_id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', type: 'goal', minute: 23 },
    ],
    match_lineups: [{ id: 'l1', match_id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', team_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', formation: '4-3-3' }],
    match_lineup_players: [
      { id: 'lp1', lineup_id: 'l1', player_id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', shirt_number: 10, starter: true },
    ],
    match_team_statistics: [{ id: 'ts1', match_id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', team_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', possession: 60 }],
    match_player_statistics: [{ id: 'ps1', match_id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', team_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', player_id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', goals: 1 }],
    team_competitions: [
      { team_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', competition_id: 'ffffffff-ffff-4fff-8fff-fffffffffff1', season_id: '44444444-4444-4444-8444-444444444444' },
      { team_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', competition_id: 'ffffffff-ffff-4fff-8fff-fffffffffff1', season_id: '44444444-4444-4444-8444-444444444444' },
    ],
    player_team_history: [
      {
        id: 'h1',
        player_id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
        team_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
        season_id: '44444444-4444-4444-8444-444444444444',
        is_current: true,
      },
    ],
    articles: [
      {
        id: 'a1',
        slug: 'big-win',
        status: 'published',
        published_at: '2026-09-01T10:00:00.000Z',
        article_type: 'news',
        is_breaking: false,
        is_featured: false,
        title: 'Big Win',
        excerpt: 'A great match',
      },
      {
        id: 'a2',
        slug: 'transfer-news',
        status: 'published',
        published_at: '2026-09-02T10:00:00.000Z',
        article_type: 'transfer',
        is_breaking: true,
        is_featured: true,
        title: 'Transfer News',
        excerpt: 'A big move',
      },
      {
        id: 'a3',
        slug: 'draft-piece',
        status: 'draft',
        published_at: null,
        article_type: 'news',
        title: 'Draft',
        excerpt: 'Not ready',
      },
    ],
    article_categories: [],
    article_tags: [],
    article_teams: [{ article_id: 'a1', team_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1' }],
    article_players: [],
    article_competitions: [],
    article_matches: [],
    categories: [
      { id: 'cat1', slug: 'pl-news', name: 'PL News', is_active: true },
      { id: 'cat2', slug: 'old-news', name: 'Old News', is_active: false },
    ],
    tags: [{ id: 'tag1', slug: 'goals', name: 'Goals' }],
    transfers: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        status: 'completed',
        transfer_type: 'permanent',
        player_id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
        from_team_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
        to_team_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
        effective_date: '2026-08-01T00:00:00.000Z',
        season_id: '22222222-2222-4222-8222-222222222222',
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        status: 'rumour',
        transfer_type: 'permanent',
        player_id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
        from_team_id: null,
        to_team_id: null,
        effective_date: null,
        season_id: '22222222-2222-4222-8222-222222222222',
      },
    ],
  };
}

export class FakeClient {
  queries: FakeQueryBuilder[] = [];
  failTables = new Set<string>();

  constructor(readonly store: FakeStore) {}

  from(table: string): unknown {
    if (!this.store[table]) this.store[table] = [];
    const query = new FakeQueryBuilder(table, this.store[table], this.failTables.has(table));
    this.queries.push(query);
    return query;
  }
}
