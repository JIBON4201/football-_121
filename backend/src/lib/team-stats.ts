/**
 * Team statistics and recent form.
 *
 * Pure functions over canonical match results — no database access — so the
 * arithmetic is unit-testable and can be reused by a cache warmer, a feed
 * builder or a future analytics job.
 *
 * Only a completed match with both scores present produces a result. A
 * scheduled, abandoned or scoreless fixture contributes nothing, and form is a
 * statement about matches already played: this module makes no prediction.
 */

export type TeamOutcome = 'win' | 'draw' | 'loss';

/** The minimum a match needs to yield a result for a team. */
export interface CompletedMatch {
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
  scheduled_at: string;
}

export interface TeamResult {
  outcome: TeamOutcome;
  goals_for: number;
  goals_against: number;
  match_id?: string;
  opponent_id?: string;
  scheduled_at: string;
}

export interface TeamTotals {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  /** Matches where the team conceded nothing. Only a real 0-0/ n-0 counts. */
  clean_sheets: number;
}

/** Statuses whose result is final and therefore countable. */
const SETTLED_STATUSES = new Set(['finished']);

export function isSettledStatus(status: string): boolean {
  return SETTLED_STATUSES.has(status);
}

function scoreOf(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** Normalize a raw row into a completed match, or null when it is not countable. */
export function asCompletedMatch(row: Record<string, unknown>): CompletedMatch | null {
  if (!isSettledStatus(String(row.status))) return null;
  const homeScore = scoreOf(row.home_score);
  const awayScore = scoreOf(row.away_score);
  const homeTeam = typeof row.home_team_id === 'string' ? row.home_team_id : null;
  const awayTeam = typeof row.away_team_id === 'string' ? row.away_team_id : null;
  const scheduledAt = typeof row.scheduled_at === 'string' ? row.scheduled_at : null;
  if (homeScore === null || awayScore === null || !homeTeam || !awayTeam || !scheduledAt) return null;
  if (homeTeam === awayTeam) return null;
  return { home_team_id: homeTeam, away_team_id: awayTeam, home_score: homeScore, away_score: awayScore, scheduled_at: scheduledAt };
}

/**
 * A team's perspective on one match. Returns null when the team was not
 * involved, so a caller cannot accidentally credit the wrong side.
 */
export function teamResultFor(match: CompletedMatch, teamId: string): TeamResult | null {
  const isHome = match.home_team_id === teamId;
  const isAway = match.away_team_id === teamId;
  if (!isHome && !isAway) return null;
  const goalsFor = isHome ? match.home_score : match.away_score;
  const goalsAgainst = isHome ? match.away_score : match.home_score;
  const outcome: TeamOutcome = goalsFor > goalsAgainst ? 'win' : goalsFor === goalsAgainst ? 'draw' : 'loss';
  return {
    outcome,
    goals_for: goalsFor,
    goals_against: goalsAgainst,
    opponent_id: isHome ? match.away_team_id : match.home_team_id,
    scheduled_at: match.scheduled_at,
  };
}

/** Aggregate a team's results. Zeros here are real zeros, not missing data. */
export function summariseResults(results: TeamResult[]): TeamTotals {
  const totals: TeamTotals = {
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goals_for: 0,
    goals_against: 0,
    goal_difference: 0,
    clean_sheets: 0,
  };
  for (const result of results) {
    totals.played += 1;
    if (result.outcome === 'win') totals.won += 1;
    else if (result.outcome === 'draw') totals.drawn += 1;
    else totals.lost += 1;
    totals.goals_for += result.goals_for;
    totals.goals_against += result.goals_against;
    if (result.goals_against === 0) totals.clean_sheets += 1;
  }
  totals.goal_difference = totals.goals_for - totals.goals_against;
  return totals;
}

/** Every countable result for a team, oldest first. */
export function resultsForTeam(matches: CompletedMatch[], teamId: string): TeamResult[] {
  const results: TeamResult[] = [];
  for (const match of matches) {
    const result = teamResultFor(match, teamId);
    if (result) results.push(result);
  }
  return results.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
}

/**
 * The most recent `limit` results, newest first. Only completed matches are
 * ever included, so this is a record of what happened — never a forecast.
 */
export function recentForm(results: TeamResult[], limit = 5): TeamResult[] {
  const size = Math.max(0, Math.trunc(limit));
  // slice(-0) is slice(0), which would return everything, so a zero or
  // negative window is handled explicitly.
  if (size === 0 || results.length === 0) return [];
  return results.slice(-size).reverse();
}
