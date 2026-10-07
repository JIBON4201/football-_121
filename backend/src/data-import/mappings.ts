/**
 * In-memory external-id → canonical UUID cache.
 *
 * One batched IN-query per (entity type × batch) warms the map; every later
 * lookup in the batch is memory-only. Warmed entries persist across batches
 * inside a run, so repeated references (team 995 in 100 fixtures) cost one
 * query per run, not per row.
 */
import type { DbClient } from '../lib/supabase';

export class MappingCache {
  private readonly map = new Map<string, string | null>();
  /** Ids this run intends to create (dry-run placeholders), keyed like `map`. */
  private readonly planned = new Set<string>();

  private static key(entityType: string, externalId: string): string {
    return `${entityType}|${externalId}`;
  }

  get(entityType: string, externalId: string): string | null | undefined {
    const hit = this.map.get(MappingCache.key(entityType, externalId));
    return hit === undefined ? undefined : hit;
  }

  set(entityType: string, externalId: string, canonicalId: string | null): void {
    this.map.set(MappingCache.key(entityType, externalId), canonicalId);
  }

  /**
   * Reserve a deterministic placeholder id for an entity this run will create.
   * Used by dry-run so downstream phases can resolve their parent references
   * without any database writes; live runs overwrite it with the real uuid.
   */
  plan(entityType: string, externalId: string): string {
    const key = MappingCache.key(entityType, externalId);
    const placeholder = `planned:${key}`;
    this.planned.add(key);
    this.map.set(key, placeholder);
    return placeholder;
  }

  isPlanned(entityType: string, externalId: string): boolean {
    return this.planned.has(MappingCache.key(entityType, externalId));
  }

  get size(): number {
    return this.map.size;
  }
}

/** Batch-prefetch canonical ids for one entity type; unknown ids cached as null. */
export async function prefetchMappings(
  client: DbClient,
  dataSourceId: string,
  entityType: string,
  externalIds: string[],
  cache: MappingCache,
): Promise<void> {
  const missing = [...new Set(externalIds)].filter((id) => cache.get(entityType, id) === undefined);
  if (missing.length === 0) return;
  // PostgREST IN-lists stay small: 500 ids per round-trip.
  for (let i = 0; i < missing.length; i += 500) {
    const chunk = missing.slice(i, i + 500);
    const { data, error } = await client
      .from('external_entity_ids')
      .select('external_id,entity_id')
      .eq('data_source_id', dataSourceId)
      .eq('entity_type', entityType)
      .in('external_id', chunk as never[]);
    if (error) throw new Error(`Mapping prefetch failed for ${entityType}: ${error.message}`);
    const found = new Set<string>();
    for (const row of ((data as Array<{ external_id: string; entity_id: string }> | null) ?? [])) {
      cache.set(entityType, String(row.external_id), String(row.entity_id));
      found.add(String(row.external_id));
    }
    for (const id of chunk) {
      if (!found.has(id)) cache.set(entityType, id, null);
    }
  }
}
