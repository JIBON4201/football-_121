import { notFound, upstream } from '../lib/errors';
import { serviceClient, type DbClient } from '../lib/supabase';
import { MAX_IN_CLAUSE_IDS } from './related';

export interface MediaRow {
  id: string;
  storage_path: string;
  public_url: string | null;
  file_name: string;
  mime_type: string;
  width: number | null;
  height: number | null;
  file_size: number | null;
  alt_text: string | null;
  caption: string | null;
  credit: string | null;
  uploaded_by: string | null;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface MediaVariantRow {
  id: string;
  media_id: string;
  variant: string;
  width: number | null;
  height: number | null;
  mime_type: string;
  storage_path: string;
  public_url: string | null;
  file_size: number | null;
  created_at: string;
}

function toMedia(data: unknown): MediaRow {
  return data as MediaRow;
}

function toVariant(data: unknown): MediaVariantRow {
  return data as MediaVariantRow;
}

export async function findMediaByIdempotencyKey(
  key: string,
  uploaderId: string,
  client: DbClient = serviceClient(),
): Promise<MediaRow | null> {
  const { data, error } = await client
    .from('media')
    .select('*')
    .eq('idempotency_key', key)
    .eq('uploaded_by', uploaderId)
    .maybeSingle();
  if (error) throw upstream('Failed to load media');
  return data ? toMedia(data) : null;
}

export async function getMediaRow(id: string, client: DbClient = serviceClient()): Promise<MediaRow> {
  const { data, error } = await client.from('media').select('*').eq('id', id).maybeSingle();
  if (error) throw upstream('Failed to load media');
  if (!data) throw notFound('Media');
  return toMedia(data);
}

export interface InsertMediaInput {
  storagePath: string;
  publicUrl: string | null;
  fileName: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  fileSize: number;
  altText?: string | null;
  caption?: string | null;
  credit?: string | null;
  uploadedBy: string;
  idempotencyKey?: string | null;
}

export async function insertMediaRow(
  input: InsertMediaInput,
  client: DbClient = serviceClient(),
): Promise<MediaRow> {
  const { data, error } = await client
    .from('media')
    .insert({
      storage_path: input.storagePath,
      public_url: input.publicUrl,
      file_name: input.fileName,
      mime_type: input.mimeType,
      width: input.width,
      height: input.height,
      file_size: input.fileSize,
      alt_text: input.altText ?? null,
      caption: input.caption ?? null,
      credit: input.credit ?? null,
      uploaded_by: input.uploadedBy,
      idempotency_key: input.idempotencyKey ?? null,
    })
    .select('*');
  if (error || !data?.length) throw upstream('Failed to create media');
  return toMedia((data as unknown[])[0]);
}

export async function updateMediaMetadata(
  id: string,
  patch: { alt_text?: string | null; caption?: string | null; credit?: string | null },
  client: DbClient = serviceClient(),
): Promise<MediaRow> {
  const { data, error } = await client.from('media').update(patch).eq('id', id).select('*');
  if (error) throw upstream('Failed to update media');
  const rows = ((data as unknown[]) ?? []).map(toMedia);
  if (!rows.length) throw notFound('Media');
  return rows[0];
}

export async function deleteMediaRow(id: string, client: DbClient = serviceClient()): Promise<void> {
  const { data, error } = await client.from('media').delete().eq('id', id).select('id');
  if (error) throw upstream('Failed to delete media');
  if (!((data as unknown[]) ?? []).length) throw notFound('Media');
}

export async function listMediaVariants(
  mediaId: string,
  client: DbClient = serviceClient(),
): Promise<MediaVariantRow[]> {
  const { data, error } = await client
    .from('media_variants')
    .select('*')
    .eq('media_id', mediaId)
    .order('created_at', { ascending: true })
    // The pipeline emits a fixed handful of variants; bounded so a corrupt
    // variant set cannot be returned wholesale.
    .range(0, 19);
  if (error) throw upstream('Failed to load media variants');
  return ((data as unknown[]) ?? []).map(toVariant);
}

export interface InsertVariantInput {
  mediaId: string;
  variant: string;
  width: number | null;
  height: number | null;
  mimeType: string;
  storagePath: string;
  publicUrl: string | null;
  fileSize: number;
}

export async function insertVariantRows(
  inputs: InsertVariantInput[],
  client: DbClient = serviceClient(),
): Promise<MediaVariantRow[]> {
  if (inputs.length === 0) return [];
  const { data, error } = await client
    .from('media_variants')
    .insert(
      inputs.map((v) => ({
        media_id: v.mediaId,
        variant: v.variant,
        width: v.width,
        height: v.height,
        mime_type: v.mimeType,
        storage_path: v.storagePath,
        public_url: v.publicUrl,
        file_size: v.fileSize,
      })),
    )
    .select('*');
  if (error) throw upstream('Failed to create media variants');
  return ((data as unknown[]) ?? []).map(toVariant);
}

/** Upper bound on references reported per media record. */
const MAX_MEDIA_REFERENCES = 200;

/**
 * Reference check across supported entities (articles today, extensible).
 */
export async function findMediaReferences(
  mediaId: string,
  client: DbClient = serviceClient(),
): Promise<Array<{ entityType: string; entityId: string }>> {
  const { data, error } = await client
    .from('articles')
    .select('id')
    .eq('featured_image_id', mediaId)
    .range(0, MAX_MEDIA_REFERENCES - 1);
  if (error) throw upstream('Failed to check media references');
  return ((data as Array<{ id: string }> | null) ?? []).map((row) => ({
    entityType: 'article',
    entityId: String(row.id),
  }));
}

/**
 * Batched variant of `findMediaReferences`.
 *
 * `listOrphanMedia` scans up to `limit` media rows; resolving references one
 * row at a time issued one query per row (an N+1). This resolves them in a
 * single query and returns the media ids that have no references.
 */
export async function findMediaIdsWithoutReferences(
  mediaIds: readonly string[],
  client: DbClient = serviceClient(),
): Promise<Set<string>> {
  const unique = [...new Set(mediaIds.filter(Boolean))].slice(0, MAX_IN_CLAUSE_IDS);
  const referenced = new Set<string>();
  if (unique.length === 0) return referenced;

  const { data, error } = await client
    .from('articles')
    .select('featured_image_id')
    .in('featured_image_id', unique)
    .limit(MAX_MEDIA_REFERENCES * 10);
  if (error) throw upstream('Failed to check media references');
  for (const row of (data as Array<{ featured_image_id: string | null }> | null) ?? []) {
    if (row.featured_image_id) referenced.add(String(row.featured_image_id));
  }
  return referenced;
}

export async function listMediaForUploader(
  uploaderId: string,
  limit = 50,
  client: DbClient = serviceClient(),
): Promise<MediaRow[]> {
  const { data, error } = await client
    .from('media')
    .select('*')
    .eq('uploaded_by', uploaderId)
    .order('created_at', { ascending: false })
    .range(0, limit - 1);
  if (error) throw upstream('Failed to load media');
  return ((data as unknown[]) ?? []).map(toMedia);
}

export async function listOrphanMedia(limit = 100, client: DbClient = serviceClient()): Promise<MediaRow[]> {
  const { data, error } = await client.from('media').select('*').order('created_at', { ascending: false }).range(0, limit - 1);
  if (error) throw upstream('Failed to load media');
  const rows = ((data as unknown[]) ?? []).map(toMedia);
  const orphans: MediaRow[] = [];
  // One batched reference query for the whole page, not one per row.
  const referenced = await findMediaIdsWithoutReferences(
    rows.map((row) => String(row.id)),
    client,
  );
  for (const row of rows) {
    if (!referenced.has(String(row.id))) orphans.push(row);
    if (orphans.length >= limit) break;
  }
  return orphans;
}

export async function recordAudit(
  action: string,
  mediaId: string,
  userId: string | null,
  details?: { oldData?: unknown; newData?: unknown },
  client: DbClient = serviceClient(),
): Promise<void> {
  await client.from('audit_logs').insert({
    user_id: userId,
    action,
    entity_type: 'media',
    entity_id: mediaId,
    old_data: (details?.oldData as Record<string, unknown> | null) ?? null,
    new_data: (details?.newData as Record<string, unknown> | null) ?? null,
  });
}
