/**
 * Step 40 — database connectivity and schema-consistency verification.
 *
 * Expectations live here (derived from supabase/migrations); observation comes
 * from the `verify_schema_health()` SQL function, because PostgREST cannot read
 * pg_catalog directly. The check diffs the two and reports drift.
 */
import type { DbClient } from '../lib/supabase';
import { fail, makeFinding, pass, skip, warn, type CheckResult, type Finding } from './types';

/** Extensions the schema depends on. */
export const REQUIRED_EXTENSIONS = ['citext', 'pg_trgm', 'pgcrypto'] as const;

/** Enum types declared across the migrations. */
export const REQUIRED_ENUMS = [
  'app_role',
  'article_status',
  'article_type',
  'match_event_type',
  'match_status',
  'sync_status',
  'transfer_status',
  'transfer_type',
  'user_status',
] as const;

/** Tables declared across the migrations. */
export const REQUIRED_TABLES = [
  'admin_permissions',
  'admin_role_permissions',
  'article_categories',
  'article_competitions',
  'article_matches',
  'article_players',
  'article_tags',
  'article_teams',
  'articles',
  'audit_logs',
  'categories',
  'competitions',
  'countries',
  'data_sources',
  'external_entity_ids',
  'match_events',
  'match_lineup_players',
  'match_lineups',
  'match_player_statistics',
  'match_team_statistics',
  'matches',
  'media',
  'media_variants',
  'notifications',
  'player_team_history',
  'players',
  'profiles',
  'redirects',
  'roles',
  'seasons',
  'seo_metadata',
  'sync_errors',
  'sync_jobs',
  'sync_schedules',
  'system_settings',
  'tags',
  'team_competitions',
  'teams',
  'transfer_windows',
  'transfers',
  'user_favorite_competitions',
  'user_favorite_players',
  'user_favorite_teams',
  'user_roles',
  'venues',
] as const;

/**
 * Content tables the public website serves. These must have RLS enabled —
 * a public read API with RLS disabled is an authorization defect.
 */
export const PUBLIC_READ_TABLES = [
  'articles',
  'categories',
  'competitions',
  'countries',
  'match_events',
  'matches',
  'media',
  'players',
  'seasons',
  'tags',
  'teams',
  'transfers',
  'venues',
] as const;

export interface SchemaHealth {
  extensions?: string[];
  enums?: string[];
  tables?: string[];
  indexes?: string[];
  functions?: string[];
  triggers?: string[];
  tables_without_rls?: string[];
  policy_count?: number;
  table_row_counts?: Record<string, number>;
}

export interface SchemaDiff {
  missingExtensions: string[];
  missingEnums: string[];
  missingTables: string[];
  missingFunctions: string[];
  publicTablesWithoutRls: string[];
  policyCount: number;
  indexCount: number;
  triggerCount: number;
  rowCounts: Record<string, number>;
}

function missing(expected: readonly string[], actual: readonly string[] | undefined): string[] {
  const have = new Set(actual ?? []);
  return expected.filter((name) => !have.has(name));
}

/** Pure diff logic — unit-testable without a database. */
export function diffSchemaHealth(health: SchemaHealth): SchemaDiff {
  const tablesWithoutRls = health.tables_without_rls ?? [];
  const publicTables = new Set<string>(PUBLIC_READ_TABLES);
  return {
    missingExtensions: missing(REQUIRED_EXTENSIONS, health.extensions),
    missingEnums: missing(REQUIRED_ENUMS, health.enums),
    missingTables: missing(REQUIRED_TABLES, health.tables),
    missingFunctions: missing(['verify_schema_health', 'verify_canonical_data'], health.functions),
    publicTablesWithoutRls: tablesWithoutRls.filter((name) => publicTables.has(name)),
    policyCount: health.policy_count ?? 0,
    indexCount: (health.indexes ?? []).length,
    triggerCount: (health.triggers ?? []).length,
    rowCounts: health.table_row_counts ?? {},
  };
}

export async function checkDatabaseConnectivity(client: DbClient): Promise<CheckResult> {
  const startedAt = Date.now();
  try {
    const { error } = await client.from('data_sources').select('id').limit(1);
    if (error) throw new Error(error.message);
    return pass(
      'db.connectivity',
      'database',
      'Supabase connectivity',
      {
        detail: 'Reached PostgREST with the service-role client.',
        durationMs: Date.now() - startedAt,
      },
    );
  } catch (error) {
    return fail(
      'db.connectivity',
      'database',
      'Supabase connectivity',
      [
        makeFinding(
          'DB_UNREACHABLE',
          'BLOCKER',
          'Cannot reach Supabase/PostgREST with the configured credentials',
          {
            detail: error instanceof Error ? error.message : 'unknown error',
            remedy:
              'Verify SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, that the project is not paused, ' +
              'and that migrations have been applied.',
          },
        ),
      ],
      { durationMs: Date.now() - startedAt },
    );
  }
}

export async function checkSchemaConsistency(client: DbClient): Promise<CheckResult> {
  const startedAt = Date.now();
  let health: SchemaHealth;
  try {
    const { data, error } = await client.rpc('verify_schema_health' as never);
    if (error) throw new Error(error.message);
    health = (data ?? {}) as SchemaHealth;
  } catch (error) {
    return skip(
      'db.schema',
      'database',
      'Schema consistency (extensions, enums, tables, indexes, triggers, RLS)',
      `Could not run verify_schema_health(): ${
        error instanceof Error ? error.message : 'unknown error'
      }. Apply supabase/migrations (including 023_step40_verification.sql) to enable this check.`,
      { durationMs: Date.now() - startedAt },
    );
  }

  const diff = diffSchemaHealth(health);
  const findings: Finding[] = [];

  for (const extension of diff.missingExtensions) {
    findings.push(
      makeFinding('DB_MISSING_EXTENSION', 'BLOCKER', `Required extension missing: ${extension}`, {
        remedy: 'Apply the migration that creates this extension.',
      }),
    );
  }
  for (const name of diff.missingEnums) {
    findings.push(
      makeFinding('DB_MISSING_ENUM', 'BLOCKER', `Required enum type missing: ${name}`, {
        remedy: 'Apply the migration that creates this enum type.',
      }),
    );
  }
  for (const table of diff.missingTables) {
    findings.push(
      makeFinding('DB_MISSING_TABLE', 'BLOCKER', `Required table missing: ${table}`, {
        remedy: 'Apply the migration that creates this table.',
      }),
    );
  }
  for (const table of diff.publicTablesWithoutRls) {
    findings.push(
      makeFinding('DB_PUBLIC_TABLE_WITHOUT_RLS', 'HIGH', `Public content table has RLS disabled: ${table}`, {
        detail: 'The API reads this table with the anon key; RLS is the authorization boundary.',
        remedy: 'Enable RLS on this table and define its read policies.',
      }),
    );
  }
  if (diff.policyCount === 0) {
    findings.push(
      makeFinding('DB_NO_RLS_POLICIES', 'BLOCKER', 'No RLS policies exist in the public schema', {
        remedy: 'Apply the migrations that define RLS policies.',
      }),
    );
  }
  if (diff.missingFunctions.length > 0) {
    findings.push(
      makeFinding(
        'DB_MISSING_VERIFICATION_FUNCTION',
        'LOW',
        `Diagnostics function(s) absent: ${diff.missingFunctions.join(', ')}`,
        { remedy: 'Apply supabase/migrations/023_step40_verification.sql.' },
      ),
    );
  }
  if (diff.indexCount === 0) {
    findings.push(
      makeFinding('DB_NO_INDEXES', 'HIGH', 'No indexes present in the public schema', {
        remedy: 'Apply migrations; search and list endpoints depend on these indexes.',
      }),
    );
  }

  const data = {
    extensions: diff.missingExtensions.length === 0 ? 'all present' : diff.missingExtensions,
    enums: diff.missingEnums.length === 0 ? 'all present' : diff.missingEnums,
    tables: diff.missingTables.length === 0 ? 'all present' : diff.missingTables,
    indexCount: diff.indexCount,
    triggerCount: diff.triggerCount,
    policyCount: diff.policyCount,
    rowCounts: diff.rowCounts,
  };

  const durationMs = Date.now() - startedAt;
  if (findings.some((f) => f.severity === 'BLOCKER')) {
    return fail('db.schema', 'database', 'Schema consistency', findings, { data, durationMs });
  }
  if (findings.length > 0) {
    return warn('db.schema', 'database', 'Schema consistency', findings, { data, durationMs });
  }
  return pass('db.schema', 'database', 'Schema consistency', {
    detail: `${REQUIRED_TABLES.length} tables, ${diff.indexCount} indexes, ${diff.policyCount} RLS policies verified.`,
    data,
    durationMs,
  });
}