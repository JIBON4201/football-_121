import type { PointsSystem, StandingsRules, TieBreakKey } from './standings-rules';
import { DEFAULT_LEAGUE_RULES, supportsTable } from './standings-rules';

/**
 * Standings calculator. Pure functions only — no database or network access —
 * so league arithmetic is unit-testable in isolation and can be reused by a
 * future cron job, admin preview or cache warmer.
 */

/** The minimum a match needs to contribute to a table. */
export interface SettledMatch {
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
  scheduled_at: string;
}

export interface StandingRow {
  team_id: string;
  position: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
}

/** Per-team totals, as aggregated by SQL or by `calculateStandings` callers. */
export interface TeamAggregate {
  team_id: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  points: number;
}

export interface StandingsResult {
  rows: StandingRow[];
  /** Matches that counted towards the table. */
  matches_considered: number;
  /** Finished matches that were present but could not be counted. */
  matches_skipped: number;
  rules_id: string;
  format: string;
}

/** Statuses whose result is final and therefore countable. */
const SETTLED_STATUSES = new Set(['finished']);

export function isSettledStatus(status: string): boolean {
  return SETTLED_STATUSES.has(status);
}

function emptyRow(teamId: string): StandingRow {
  return {
    team_id: teamId,
    position: 0,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goals_for: 0,
    goals_against: 0,
    goal_difference: 0,
    points: 0,
  };
}

function applyMatch(
  home: StandingRow,
  away: StandingRow,
  homeScore: number,
  awayScore: number,
  points: PointsSystem,
): void {
  home.played += 1;
  away.played += 1;
  home.goals_for += homeScore;
  home.goals_against += awayScore;
  away.goals_for += awayScore;
  away.goals_against += homeScore;

  if (homeScore > awayScore) {
    home.won += 1;
    away.lost += 1;
    home.points += points.win;
    away.points += points.loss;
  } else if (awayScore > homeScore) {
    away.won += 1;
    home.lost += 1;
    away.points += points.win;
    home.points += points.loss;
  } else {
    home.drawn += 1;
    away.drawn += 1;
    home.points += points.draw;
    away.points += points.draw;
  }
}

export interface HeadToHead {
  points: Map<string, number>;
  goalDifference: Map<string, number>;
}

/** Head-to-head totals from a plain match list, for callers aggregating in SQL. */
export function headToHeadFrom(matches: SettledMatch[], teamIds: string[]): HeadToHead {
  return buildHeadToHead(matches, teamIds);
}

/** Points and goal difference earned in direct meetings only. */
function buildHeadToHead(matches: SettledMatch[], teamIds: string[]): HeadToHead {
  const points = new Map<string, number>();
  const goalDifference = new Map<string, number>();
  const involved = new Set(teamIds);
  for (const id of teamIds) {
    points.set(id, 0);
    goalDifference.set(id, 0);
  }
  for (const match of matches) {
    if (!involved.has(match.home_team_id) || !involved.has(match.away_team_id)) continue;
    if (match.home_team_id === match.away_team_id) continue;
    const homePoints = match.home_score > match.away_score ? 3 : match.home_score === match.away_score ? 1 : 0;
    const awayPoints = match.home_score > match.away_score ? 0 : match.home_score === match.away_score ? 1 : 3;
    points.set(match.home_team_id, (points.get(match.home_team_id) ?? 0) + homePoints);
    points.set(match.away_team_id, (points.get(match.away_team_id) ?? 0) + awayPoints);
    goalDifference.set(
      match.home_team_id,
      (goalDifference.get(match.home_team_id) ?? 0) + (match.home_score - match.away_score),
    );
    goalDifference.set(
      match.away_team_id,
      (goalDifference.get(match.away_team_id) ?? 0) + (match.away_score - match.home_score),
    );
  }
  return { points, goalDifference };
}

function comparator(
  rules: StandingsRules,
  headToHead: HeadToHead | null,
  nameById: Map<string, string>,
): (a: StandingRow, b: StandingRow) => number {
  const value = (row: StandingRow, key: TieBreakKey): number | string => {
    switch (key) {
      case 'points':
        return row.points;
      case 'goal_difference':
        return row.goal_difference;
      case 'goals_for':
        return row.goals_for;
      case 'goals_against':
        return row.goals_against;
      case 'wins':
        return row.won;
      case 'played':
        return row.played;
      case 'head_to_head_points':
        return headToHead?.points.get(row.team_id) ?? 0;
      case 'head_to_head_goal_difference':
        return headToHead?.goalDifference.get(row.team_id) ?? 0;
      case 'name':
        return (nameById.get(row.team_id) ?? '').toLowerCase();
      default:
        return 0;
    }
  };

  return (a, b) => {
    for (const key of rules.tieBreaks) {
      const left = value(a, key);
      const right = value(b, key);
      if (typeof left === 'string' || typeof right === 'string') {
        const cmp = String(left).localeCompare(String(right));
        if (cmp !== 0) return cmp;
        continue;
      }
      if (left !== right) return right - left;
    }
    // Absolute fallback: two rows can never compare equal.
    return a.team_id.localeCompare(b.team_id);
  };
}

export interface CalculateOptions {
  rules?: StandingsRules;
  /** Participating teams, so a side with no matches still appears. */
  teamIds?: string[];
  /** Team names, used only for the final alphabetical tie-break. */
  nameById?: Map<string, string>;
  /** Every finished match, including ones the filter rejected. */
  totalFinished?: number;
}

/**
 * Build a league table from settled matches.
 *
 * A team is only credited for a match that is finished *and* has both scores
 * present. Postponed, abandoned, cancelled and suspended fixtures are ignored
 * entirely rather than counted as losses, and a result missing a score is
 * reported through `matches_skipped` so callers can surface an
 * incomplete-data state instead of a quietly wrong table.
 */
export function calculateStandings(matches: SettledMatch[], options: CalculateOptions = {}): StandingsResult {
  const rules = options.rules ?? DEFAULT_LEAGUE_RULES;
  const nameById = options.nameById ?? new Map<string, string>();

  if (!supportsTable(rules)) {
    return { rows: [], matches_considered: 0, matches_skipped: 0, rules_id: rules.id, format: rules.format };
  }

  const rows = new Map<string, StandingRow>();
  const ensure = (teamId: string): StandingRow => {
    let row = rows.get(teamId);
    if (!row) {
      row = emptyRow(teamId);
      rows.set(teamId, row);
    }
    return row;
  };

  for (const teamId of options.teamIds ?? []) ensure(teamId);

  const settled: SettledMatch[] = [];
  let skipped = 0;
  for (const match of matches) {
    if (
      typeof match.home_score !== 'number' ||
      typeof match.away_score !== 'number' ||
      !Number.isFinite(match.home_score) ||
      !Number.isFinite(match.away_score) ||
      match.home_team_id === match.away_team_id
    ) {
      skipped += 1;
      continue;
    }
    settled.push(match);
    applyMatch(
      ensure(match.home_team_id),
      ensure(match.away_team_id),
      match.home_score,
      match.away_score,
      rules.points,
    );
  }

  for (const row of rows.values()) row.goal_difference = row.goals_for - row.goals_against;

  const list = Array.from(rows.values());
  const needsHeadToHead = rules.tieBreaks.some((key) => key.startsWith('head_to_head'));
  const headToHead = needsHeadToHead ? buildHeadToHead(settled, list.map((row) => row.team_id)) : null;

  list.sort(comparator(rules, headToHead, nameById));
  list.forEach((row, index) => {
    row.position = index + 1;
  });

  const totalFinished = options.totalFinished;
  const unreported = totalFinished !== undefined ? Math.max(0, totalFinished - settled.length - skipped) : 0;

  return {
    rows: list,
    matches_considered: settled.length,
    matches_skipped: skipped + unreported,
    rules_id: rules.id,
    format: rules.format,
  };
}

/**
 * Rank a table from per-team totals that were already aggregated (in SQL).
 *
 * Produces the same rows as `calculateStandings` would from the equivalent match
 * list, without re-reading every fixture. Head-to-head tie-breaks need per-match
 * data, so they are only honoured when the caller supplies them; otherwise the
 * remaining tie-breaks decide and `team_id` settles a genuine tie.
 */
export function rankAggregates(
  aggregates: TeamAggregate[],
  options: CalculateOptions & { headToHead?: HeadToHead | null } = {},
): StandingsResult {
  const rules = options.rules ?? DEFAULT_LEAGUE_RULES;

  if (!supportsTable(rules)) {
    return { rows: [], matches_considered: 0, matches_skipped: 0, rules_id: rules.id, format: rules.format };
  }

  const rows = new Map<string, StandingRow>();
  const ensure = (teamId: string): StandingRow => {
    let row = rows.get(teamId);
    if (!row) {
      row = emptyRow(teamId);
      rows.set(teamId, row);
    }
    return row;
  };

  for (const teamId of options.teamIds ?? []) ensure(teamId);

  for (const aggregate of aggregates) {
    const row = ensure(aggregate.team_id);
    row.played = aggregate.played;
    row.won = aggregate.won;
    row.drawn = aggregate.drawn;
    row.lost = aggregate.lost;
    row.goals_for = aggregate.goals_for;
    row.goals_against = aggregate.goals_against;
    row.points = aggregate.points;
    row.goal_difference = row.goals_for - row.goals_against;
  }

  const nameById = options.nameById ?? new Map<string, string>();
  const list = Array.from(rows.values());
  list.sort(comparator(rules, options.headToHead ?? null, nameById));
  list.forEach((row, index) => {
    row.position = index + 1;
  });

  // Every finished match contributes two team appearances.
  const considered = Math.round(list.reduce((total, row) => total + row.played, 0) / 2);
  const totalFinished = options.totalFinished;
  const unreported = totalFinished !== undefined ? Math.max(0, totalFinished - considered) : 0;

  return {
    rows: list,
    matches_considered: considered,
    matches_skipped: unreported,
    rules_id: rules.id,
    format: rules.format,
  };
}
