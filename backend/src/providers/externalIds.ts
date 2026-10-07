import { upstream } from '../lib/errors';
import type { DbClient } from '../lib/supabase';

/** Raised when one canonical entity already maps to a different external ID. */
export class MappingConflictError extends Error {
  readonly dataSourceId: string;
  readonly entityType: string;

  constructor(dataSourceId: string, entityType: string, message: string) {
    super(message);
    this.name = 'MappingConflictError';
    this.dataSourceId = dataSourceId;
    this.entityType = entityType;
  }
}

const TABLE = 'external_entity_ids';

/** provider + entity_type + external_id → canonical UUID (or null). */
export async function lookupMapping(
  client: DbClient,
  dataSourceId: string,
  entityType: string,
  externalId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from(TABLE)
    .select('entity_id')
    .eq('data_source_id', dataSourceId)
    .eq('entity_type', entityType)
    .eq('external_id', externalId)
    .maybeSingle();
  if (error) throw upstream('External ID lookup failed');
  return (data as { entity_id: string } | null)?.entity_id ?? null;
}

/**
 * Create or update a mapping. Detects the conflict case where the canonical
 * entity already maps to a different external record for the same provider.
 */
export async function saveMapping(
  client: DbClient,
  dataSourceId: string,
  entityType: string,
  externalId: string,
  entityId: string,
): Promise<'created' | 'updated'> {
  const { data: reverse, error: reverseError } = await client
    .from(TABLE)
    .select('external_id')
    .eq('data_source_id', dataSourceId)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .maybeSingle();
  if (reverseError) throw upstream('External ID lookup failed');
  const existingExternal = (reverse as { external_id: string } | null)?.external_id;
  if (existingExternal && existingExternal !== externalId) {
    throw new MappingConflictError(
      dataSourceId,
      entityType,
      `Canonical ${entityType} already maps to a different external record for this provider`,
    );
  }
  const { error } = await client.from(TABLE).upsert(
    {
      data_source_id: dataSourceId,
      entity_type: entityType,
      external_id: externalId,
      entity_id: entityId,
    },
    { onConflict: 'data_source_id,entity_type,external_id' },
  );
  if (error) throw upstream('External ID mapping failed');
  return existingExternal ? 'updated' : 'created';
}
