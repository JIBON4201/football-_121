/**
 * Pure dataset normalization (no database access — fully unit-testable).
 *
 * Discipline, per DATASET_MAPPING_REPORT.md: 0 is never NULL and NULL is
 * never 0; unparseable values become null (caller quarantines when the field
 * is load-bearing); nothing is invented.
 */
import { slugify } from '../providers/normalize';
import type { NormalizedMatchStatus } from '../providers/types';

/** BigInt/number/string → canonical external-id string; null/undefined/'' → null. */
export function toExternalId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return String(Math.trunc(value));
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  return null;
}

/** Non-empty trimmed text capped at maxLength, else null. */
export function toText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

/** Dataset datetimes are tz-naive UTC; force UTC instead of server-local parse. */
export function toInstantUtc(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim();
  const zoned = /[Zz]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}Z`;
  const time = Date.parse(zoned);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/** Finite number within [min, max]; BigInt is converted when safe. */
export function toFloat(value: unknown, min: number, max: number): number | null {
  let num: number | null = null;
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    num = Number(value);
  } else if (typeof value === 'number') {
    num = value;
  } else {
    return null;
  }
  if (!Number.isFinite(num) || num < min || num > max) return null;
  return num;
}

export function toInt(value: unknown, min: number, max: number): number | null {
  const num = toFloat(value, min, max);
  return num === null ? null : Math.floor(num);
}

/**
 * Provider numerics arrive as strings in the flat stats feed ("6.5", "7").
 * Coerce strictly with range validation; anything else is null so the caller
 * can quarantine instead of silently storing garbage.
 */
export function coerceNumericString(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'bigint') return toFloat(value, min, max);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num < min || num > max) return null;
  return num;
}

/** Controlled ISO-3 map for dataset country names. Unknown → null (never guessed). */
const COUNTRY_ISO: Record<string, string> = {
  england: 'ENG',
  spain: 'ESP',
  germany: 'GER',
  italy: 'ITA',
  france: 'FRA',
  portugal: 'POR',
  netherlands: 'NED',
  scotland: 'SCO',
  wales: 'WAL',
  'northern ireland': 'NIR',
  'republic of ireland': 'IRL',
  ireland: 'IRL',
  belgium: 'BEL',
  austria: 'AUT',
  switzerland: 'SUI',
  greece: 'GRE',
  turkey: 'TUR',
  russia: 'RUS',
  ukraine: 'UKR',
  poland: 'POL',
  'czech republic': 'CZE',
  czechia: 'CZE',
  slovakia: 'SVK',
  hungary: 'HUN',
  romania: 'ROU',
  bulgaria: 'BUL',
  serbia: 'SRB',
  croatia: 'CRO',
  slovenia: 'SVN',
  bosnia: 'BIH',
  'bosnia and herzegovina': 'BIH',
  montenegro: 'MNE',
  albania: 'ALB',
  norway: 'NOR',
  sweden: 'SWE',
  denmark: 'DEN',
  finland: 'FIN',
  iceland: 'ISL',
  colombia: 'COL',
  brazil: 'BRA',
  argentina: 'ARG',
  uruguay: 'URU',
  chile: 'CHI',
  peru: 'PER',
  ecuador: 'ECU',
  paraguay: 'PAR',
  bolivia: 'BOL',
  venezuela: 'VEN',
  mexico: 'MEX',
  usa: 'USA',
  'united states': 'USA',
  canada: 'CAN',
  japan: 'JPN',
  'south korea': 'KOR',
  'korea republic': 'KOR',
  china: 'CHN',
  australia: 'AUS',
  egypt: 'EGY',
  morocco: 'MAR',
  nigeria: 'NGA',
  ghana: 'GHA',
  senegal: 'SEN',
  cameroon: 'CMR',
  'south africa': 'RSA',
  israel: 'ISR',
  'saudi arabia': 'KSA',
  qatar: 'QAT',
  uae: 'UAE',
  india: 'IND',
};

/**
 * Dataset country name → ISO-3 code. "World" (cup competitions) and anything
 * unmapped return null so competitions keep a NULL country_id rather than a
 * fabricated country row.
 */
export function mapCountryCode(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const key = name.trim().toLowerCase();
  if (!key || key === 'world') return null;
  return COUNTRY_ISO[key] ?? null;
}

/** Split "Leonardo Balerdi" → first/last only when exactly two tokens exist. */
export function splitName(name: string): { firstName?: string; lastName?: string } {
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 2) return { firstName: tokens[0], lastName: tokens[1] };
  return {};
}

/** Deterministic slug with the dataset id as collision-proof suffix input. */
export function datasetSlug(kind: 'team' | 'player' | 'competition' | 'country', name: string, datasetId: string): string {
  void kind;
  return slugify(name, datasetId);
}

/**
 * Season derivation. The dataset carries no season linkage — only calendar
 * years — so seasons are SYNTHETIC calendar-year buckets, always flagged
 * approximate. Never presented as authoritative season alignment.
 */
export function deriveSeason(calendarYear: number): { name: string; startDate: string; endDate: string; approximate: true } | null {
  if (!Number.isInteger(calendarYear) || calendarYear < 1990 || calendarYear > 2100) return null;
  const year = String(calendarYear);
  return { name: year, startDate: `${year}-01-01`, endDate: `${year}-12-31`, approximate: true as const };
}

export function seasonExternalId(competitionDatasetId: string, calendarYear: number): string {
  return `season:${competitionDatasetId}:${calendarYear}`;
}

export type MatchStatusOutcome =
  | { kind: 'mapped'; status: NormalizedMatchStatus }
  | { kind: 'quarantine'; reason: string };

const FINISHED = new Set(['FT', 'AET', 'PEN']);

/**
 * status_norm → match_status. AWD/WO/OTHER have no safe equivalent and are
 * quarantined, never silently converted.
 */
export function mapMatchStatus(statusNorm: unknown): MatchStatusOutcome {
  if (typeof statusNorm !== 'string' || !statusNorm) {
    return { kind: 'quarantine', reason: 'missing status_norm' };
  }
  const code = statusNorm.trim().toUpperCase();
  if (FINISHED.has(code)) return { kind: 'mapped', status: 'finished' };
  switch (code) {
    case 'NS':
      return { kind: 'mapped', status: 'scheduled' };
    case 'PST':
      return { kind: 'mapped', status: 'postponed' };
    case 'CANC':
      return { kind: 'mapped', status: 'cancelled' };
    case 'ABD':
      return { kind: 'mapped', status: 'abandoned' };
    case 'SUSP':
      return { kind: 'mapped', status: 'suspended' };
    default:
      return { kind: 'quarantine', reason: `unmappable status_norm '${statusNorm}' (AWD/WO/OTHER require manual review)` };
  }
}

/**
 * Substitute derivation. The feed marks starters but has no bench flag:
 * non-starters with recorded involvement are substitutes, the rest are
 * squad appearances without a known role (substitute=false).
 */
export function deriveSubstitute(isStarter: boolean, minutes: number | null, rating: number | null): boolean {
  if (isStarter) return false;
  return (minutes !== null && minutes > 0) || rating !== null;
}

/** Normalize a single-letter position code; stored raw, never expanded. */
export function normalizePositionCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{1,3}$/.test(code) ? code : null;
}

/** Shallow equality over defined DTO fields (skip-unchanged detection). */
export function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>, keys: string[]): boolean {
  for (const key of keys) {
    if ((a[key] ?? null) !== (b[key] ?? null)) return false;
  }
  return true;
}
