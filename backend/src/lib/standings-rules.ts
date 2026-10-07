/**
 * Standings rules.
 *
 * League behaviour is expressed as data, never as logic baked into the
 * calculator. Every rule set is keyed by competition `type` and falls back to
 * a single documented default, so adding a new format (or making a rule
 * per-competition) is a registry change, not a rewrite.
 *
 * Future configuration sources — a `competition_settings` table, an admin
 * screen, or a provider feed — only need to produce a `StandingsRules` value.
 */

/** How a competition is structured. Currently only `league` is calculated. */
export type CompetitionFormat = 'league' | 'group' | 'knockout';

export interface PointsSystem {
  win: number;
  draw: number;
  loss: number;
}

/**
 * Ordered tie-break keys. `name` is always appended as a deterministic
 * final tie-break so a table can never contain two identical rows.
 */
export type TieBreakKey =
  | 'points'
  | 'goal_difference'
  | 'goals_for'
  | 'goals_against'
  | 'wins'
  | 'played'
  | 'head_to_head_points'
  | 'head_to_head_goal_difference'
  | 'name';

export interface StandingsRules {
  /** Stable id, useful for cache keys and future persisted config. */
  id: string;
  format: CompetitionFormat;
  points: PointsSystem;
  tieBreaks: TieBreakKey[];
}

/** Standard association-football league table: 3/1/0, goal difference first. */
export const DEFAULT_LEAGUE_RULES: StandingsRules = {
  id: 'league.standard',
  format: 'league',
  points: { win: 3, draw: 1, loss: 0 },
  tieBreaks: [
    'points',
    'goal_difference',
    'goals_for',
    'wins',
    'head_to_head_points',
    'name',
  ],
};

/**
 * A two-point win system exists in some competitions; a group stage shares the
 * league arithmetic but must be keyed separately so its own rules can diverge.
 */
export const TWO_POINT_LEAGUE_RULES: StandingsRules = {
  id: 'league.two-point',
  format: 'league',
  points: { win: 2, draw: 1, loss: 0 },
  tieBreaks: ['points', 'goal_difference', 'goals_for', 'wins', 'name'],
};

export const GROUP_STAGE_RULES: StandingsRules = {
  id: 'group.standard',
  format: 'group',
  points: { win: 3, draw: 1, loss: 0 },
  tieBreaks: ['points', 'goal_difference', 'goals_for', 'head_to_head_points', 'name'],
};

/**
 * Knockout competitions have no meaningful table. The ruleset still exists so
 * the calculator has a single code path and can report an honest
 * "not applicable" state rather than inventing a table.
 */
export const KNOCKOUT_RULES: StandingsRules = {
  id: 'knockout.standard',
  format: 'knockout',
  points: { win: 0, draw: 0, loss: 0 },
  tieBreaks: ['name'],
};

const REGISTRY: Record<string, StandingsRules> = {
  'league.two-point': TWO_POINT_LEAGUE_RULES,
  'group.standard': GROUP_STAGE_RULES,
  'knockout.standard': KNOCKOUT_RULES,
};

/** Competition `type` values that map onto a non-default ruleset. */
const TYPE_TO_RULES: Record<string, string> = {
  cup: 'knockout.standard',
  trophy: 'knockout.standard',
  playoff: 'knockout.standard',
  playoffs: 'knockout.standard',
  group_stage: 'group.standard',
};

/**
 * Resolve the ruleset for a competition. `type` is matched case-insensitively;
 * an unknown or missing type falls back to the standard league table so a new
 * competition is never left without standings.
 */
export function resolveStandingsRules(competitionType: string | null | undefined): StandingsRules {
  const key = (competitionType ?? '').trim().toLowerCase();
  const rulesId = TYPE_TO_RULES[key];
  if (rulesId) return REGISTRY[rulesId] ?? DEFAULT_LEAGUE_RULES;
  return DEFAULT_LEAGUE_RULES;
}

/**
 * Persisted per-competition override hook. Returns a validated ruleset when
 * the caller has configuration for this competition, otherwise null.
 *
 * Intentionally a no-op until a configuration source exists — it exists so the
 * lookup path is already shaped and callers never special-case it.
 */
export function overrideRulesFor(competitionId: string): StandingsRules | null {
  void competitionId;
  return null;
}

/** Final ruleset: explicit override, then type mapping, then the default. */
export function standingsRulesFor(
  competition: { id?: unknown; type?: unknown },
  competitionType?: string | null,
): StandingsRules {
  const id = typeof competition.id === 'string' ? competition.id : '';
  const override = id ? overrideRulesFor(id) : null;
  if (override) return override;
  const type = competitionType ?? (typeof competition.type === 'string' ? competition.type : null);
  return resolveStandingsRules(type);
}

/** True when a table can legitimately be produced for these rules. */
export function supportsTable(rules: StandingsRules): boolean {
  return rules.format === 'league' || rules.format === 'group';
}
