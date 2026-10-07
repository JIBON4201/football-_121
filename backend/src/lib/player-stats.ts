/**
 * Player statistics aggregation.
 *
 * Pure functions over `match_player_statistics` rows. The central rule: a
 * statistic that was not reported is NOT a zero. A field is summed only from
 * the rows that actually carry it, and any field missing from at least one
 * contributing row is reported as `partial` so a consumer can qualify it
 * instead of presenting a misleading total.
 *
 * Aggregations always happen here, server-side, over a bounded result set — the
 * browser never sums a player's career.
 */

export const PLAYER_STAT_FIELDS = [
  'minutes',
  'goals',
  'assists',
  'shots',
  'shots_on_target',
  'passes',
  'pass_accuracy',
  'tackles',
  'interceptions',
  'clearances',
  'yellow_cards',
  'red_cards',
  'rating',
] as const;

export type PlayerStatKey = (typeof PLAYER_STAT_FIELDS)[number];

export interface PlayerStatSample {
  minutes: number | null;
  goals: number | null;
  assists: number | null;
  shots: number | null;
  shots_on_target: number | null;
  passes: number | null;
  pass_accuracy: number | null;
  tackles: number | null;
  interceptions: number | null;
  clearances: number | null;
  yellow_cards: number | null;
  red_cards: number | null;
  rating: number | null;
}

export interface PlayerAggregate {
  /** Number of appearances backing these figures. */
  appearances: number;
  /** Sum of reported values, or null when no row reported the field at all. */
  values: Record<PlayerStatKey, number | null>;
  /** Fields missing from at least one contributing row: a partial total. */
  partial: PlayerStatKey[];
  /** Fields no row reported: unavailable, and deliberately not zero. */
  unavailable: PlayerStatKey[];
  /** Mean rating over the rows that reported one, or null. */
  average_rating: number | null;
  /** How many rows carried a rating at all. */
  ratings_reported: number;
}

/** Ratings are an average, so they are rounded; counts stay exact. */
const AVERAGE_FIELDS: ReadonlySet<PlayerStatKey> = new Set(['rating', 'pass_accuracy']);

function emptyValues(): Record<PlayerStatKey, number | null> {
  const values = {} as Record<PlayerStatKey, number | null>;
  for (const field of PLAYER_STAT_FIELDS) values[field] = null;
  return values;
}

/**
 * Aggregate per-match statistics.
 *
 * `pass_accuracy` is also a mean rather than a sum, so it is treated like a
 * rating: a plain sum would be meaningless.
 */
export function aggregatePlayerStats(samples: PlayerStatSample[]): PlayerAggregate {
  const values = emptyValues();
  const partial: PlayerStatKey[] = [];
  const unavailable: PlayerStatKey[] = [];
  if (samples.length === 0) {
    return {
      appearances: 0,
      values,
      partial,
      unavailable: [...PLAYER_STAT_FIELDS],
      average_rating: null,
      ratings_reported: 0,
    };
  }

  const counts = {} as Record<PlayerStatKey, number>;
  const totals = {} as Record<PlayerStatKey, number>;
  for (const field of PLAYER_STAT_FIELDS) {
    counts[field] = 0;
    totals[field] = 0;
  }

  for (const sample of samples) {
    for (const field of PLAYER_STAT_FIELDS) {
      const value = sample[field];
      if (typeof value === 'number' && Number.isFinite(value)) {
        counts[field] += 1;
        totals[field] += value;
      }
    }
  }

  for (const field of PLAYER_STAT_FIELDS) {
    if (counts[field] === 0) {
      // Nothing reported this statistic. Null, never zero.
      values[field] = null;
      unavailable.push(field);
      continue;
    }
    const mean = totals[field] / counts[field];
    values[field] = AVERAGE_FIELDS.has(field) ? Math.round(mean * 100) / 100 : totals[field];
    if (counts[field] < samples.length) partial.push(field);
  }

  return {
    appearances: samples.length,
    values,
    partial,
    unavailable,
    average_rating: values.rating,
    ratings_reported: counts.rating,
  };
}

/** The scope a set of statistics describes, derived from the active filters. */
export type PlayerStatsScope = 'career' | 'season' | 'competition' | 'season_competition';

export function scopeFor(hasSeason: boolean, hasCompetition: boolean): PlayerStatsScope {
  if (hasSeason && hasCompetition) return 'season_competition';
  if (hasSeason) return 'season';
  if (hasCompetition) return 'competition';
  return 'career';
}

export const SCOPE_LABELS: Record<PlayerStatsScope, string> = {
  career: 'All recorded appearances',
  season: 'Single season',
  competition: 'Single competition',
  season_competition: 'Single season and competition',
};
