/**
 * Fixture-aligned merge of two dataset files streaming in fixture_id order.
 *
 * The 10M-row files cannot be joined in memory and parquet has no index, but
 * every join-relevant file is sorted by fixture_id ascending (verified during
 * inspection), so a primary + secondary file can be consumed in lockstep.
 * Checkpoints store per-file row offsets rewound to a fixture boundary, so a
 * resumed run replays at most one fixture — safe because every persist path
 * is idempotent (update-on-natural-key).
 */

export interface FixtureRow {
  fixtureId: string;
  row: Record<string, unknown>;
}

export interface FixtureGroup {
  fixtureId: string;
  primary: Record<string, unknown>[];
  secondary: Record<string, unknown>[];
  /** True when the fixture appears only in the secondary file. */
  shellOnly: boolean;
}

export interface AlignedBatch {
  groups: FixtureGroup[];
  /** Next read offsets (rewound to the boundary fixture for idempotent replay). */
  nextPrimaryOffset: number;
  nextSecondaryOffset: number;
  /** Highest fixture id fully covered by this batch (for shell suppression). */
  maxFixture: string | null;
  primaryExhausted: boolean;
}

function compareFixture(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isSafeInteger(na) && Number.isSafeInteger(nb) && String(na) === a && String(nb) === b) {
    return na - nb;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

export function toFixtureRows(rows: Record<string, unknown>[], idColumn: string): FixtureRow[] {
  const out: FixtureRow[] = [];
  for (const row of rows) {
    const id = row[idColumn];
    if (id === null || id === undefined || id === '') continue;
    out.push({ fixtureId: String(id), row });
  }
  return out;
}

/**
 * Align one window pair into per-fixture groups.
 *
 * - `prevMaxFixture`: highest fixture covered by earlier batches; secondary
 *   rows at or below it were already emitted (prevents shell re-emission).
 * - `emitShells`: emit groups for fixtures seen only in the secondary file
 *   (e.g. appearances without a lineup row → lineup shells).
 * - When the primary window is empty (primary file exhausted), the secondary
 *   remainder drains as shells (if enabled) and offsets jump to the ends.
 */
export function alignFixtureBatch(
  primary: FixtureRow[],
  primaryStart: number,
  secondary: FixtureRow[],
  secondaryStart: number,
  prevMaxFixture: string | null,
  emitShells: boolean,
): AlignedBatch {
  const primaryByFixture = new Map<string, Record<string, unknown>[]>();
  for (const r of primary) {
    const list = primaryByFixture.get(r.fixtureId) ?? [];
    list.push(r.row);
    primaryByFixture.set(r.fixtureId, list);
  }
  const secondaryByFixture = new Map<string, Record<string, unknown>[]>();
  for (const r of secondary) {
    const list = secondaryByFixture.get(r.fixtureId) ?? [];
    list.push(r.row);
    secondaryByFixture.set(r.fixtureId, list);
  }

  const primaryIds = [...primaryByFixture.keys()];
  const maxFixture = primaryIds.length > 0 ? primaryIds.reduce((a, b) => (compareFixture(a, b) > 0 ? a : b)) : null;

  const fixtureSet = new Set<string>([...primaryByFixture.keys()]);
  if (emitShells) {
    for (const id of secondaryByFixture.keys()) {
      if (!fixtureSet.has(id) && (prevMaxFixture === null || compareFixture(id, prevMaxFixture) > 0)) {
        if (maxFixture === null || compareFixture(id, maxFixture) <= 0) fixtureSet.add(id);
      }
    }
  }
  const ordered = [...fixtureSet].sort(compareFixture);
  const groups: FixtureGroup[] = ordered.map((fixtureId) => ({
    fixtureId,
    primary: primaryByFixture.get(fixtureId) ?? [],
    secondary: secondaryByFixture.get(fixtureId) ?? [],
    shellOnly: !primaryByFixture.has(fixtureId),
  }));

  // Rewind both offsets to the boundary fixture so a spanning fixture replays.
  let nextPrimaryOffset = primaryStart + primary.length;
  if (maxFixture !== null) {
    const idx = primary.findIndex((r) => r.fixtureId === maxFixture);
    if (idx >= 0) nextPrimaryOffset = primaryStart + idx;
  }
  let nextSecondaryOffset = secondaryStart + secondary.length;
  if (maxFixture !== null) {
    const idx = secondary.findIndex((r) => compareFixture(r.fixtureId, maxFixture) >= 0);
    // Rows strictly below the boundary fixture are fully consumed. Rows at the
    // boundary rewind for idempotent replay (the fixture may span windows).
    if (idx >= 0) nextSecondaryOffset = secondaryStart + idx;
  }
  return { groups, nextPrimaryOffset, nextSecondaryOffset, maxFixture, primaryExhausted: primary.length === 0 };
}
