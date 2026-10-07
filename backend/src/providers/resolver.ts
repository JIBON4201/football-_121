import { upstream } from '../lib/errors';
import type { DbClient } from '../lib/supabase';
import { lookupMapping, saveMapping } from './externalIds';

export type ResolutionOutcome =
  | { status: 'mapped'; entityId: string }
  | { status: 'matched'; entityId: string }
  | { status: 'missing' }
  | { status: 'ambiguous' };

/**
 * Canonical entity resolution order:
 * 1. existing provider external ID mapping,
 * 2. single deterministic slug match (mapping created),
 * 3. missing (caller creates, then maps),
 * 4. ambiguous (multiple slug hits — never auto-merged).
 */
export async function resolveEntity(
  client: DbClient,
  options: {
    dataSourceId: string;
    entityType: string;
    externalId: string;
    table: string;
    slug: string;
    /** Dry-run mode: classify without writing mappings. */
    dryRun?: boolean;
  },
): Promise<ResolutionOutcome> {
  const mapped = await lookupMapping(client, options.dataSourceId, options.entityType, options.externalId);
  if (mapped) return { status: 'mapped', entityId: mapped };

  const { data, error } = await client.from(options.table).select('id').eq('slug', options.slug);
  if (error) throw upstream(`Entity resolution failed for ${options.entityType}`);
  const candidates = ((data as Array<{ id: string }> | null) ?? []).map((row) => row.id);
  if (candidates.length === 1) {
    if (!options.dryRun) {
      await saveMapping(client, options.dataSourceId, options.entityType, options.externalId, candidates[0]);
    }
    return { status: 'matched', entityId: candidates[0] };
  }
  if (candidates.length > 1) return { status: 'ambiguous' };
  return { status: 'missing' };
}
