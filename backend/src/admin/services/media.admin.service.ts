/**
 * Step 11 — Admin media service (reuses media tables + storage + mediaService).
 *
 * Upload, metadata update and delete delegate to the existing mediaService
 * (magic-byte validation, variant pipeline, ref-counted delete, audit).
 * List/get query the media tables directly via serviceClient() (admin sees
 * all uploads). No new tables, no new storage system, no secrets in rows.
 */
import { badRequest, toServiceError } from '../../lib/errors';
import { buildPagination, paginateInput } from '../../lib/pagination';
import { serviceClient } from '../../lib/supabase';
import { escapeIlike } from '../../lib/validate';
import { findMediaReferences, getMediaRow, listMediaVariants } from '../../repositories/media.repo';
import { mediaService } from '../../services/media.service';
import { writeAdminAudit } from '../audit';

const COLUMNS =
  'id,storage_path,file_name,mime_type,width,height,file_size,alt_text,caption,credit,uploaded_by,created_at';

export interface AdminMediaListInput {
  page: number;
  limit: number;
  q?: string;
  mimeType?: string;
  from?: string;
  to?: string;
  sort?: string;
  order?: string;
}

function decodeBase64(contentBase64: string): Uint8Array {
  let buffer: Buffer;
  try {
    buffer = Buffer.from(contentBase64, 'base64');
  } catch {
    throw badRequest('Invalid base64 content');
  }
  if (buffer.length === 0) throw badRequest('Empty file upload');
  return new Uint8Array(buffer);
}

export const adminMediaService = {
  list: async (input: AdminMediaListInput) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = serviceClient() as any;
      const page = paginateInput(input.page, input.limit);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query: any = client.from('media').select(COLUMNS, { count: 'exact' });
      if (input.mimeType) query = query.eq('mime_type', input.mimeType);
      if (input.from) query = query.gte('created_at', `${input.from}T00:00:00.000Z`);
      if (input.to) query = query.lte('created_at', `${input.to}T23:59:59.999Z`);
      if (input.q) {
        const term = escapeIlike(input.q);
        if (term.length > 0) query = query.or(`file_name.ilike.%${term}%`);
      }
      const sorts: Record<string, string> = { created_at: 'created_at', file_size: 'file_size' };
      const col = sorts[input.sort ?? ''] ?? 'created_at';
      const asc = (input.order ?? 'desc') === 'asc';
      const { data, error, count } = await query.order(col, { ascending: asc }).order('id', { ascending: asc }).range(page.from, page.to);
      if (error) throw new Error('media list failed');
      return { rows: (data as unknown[]) ?? [], pagination: buildPagination(count ?? 0, page) };
    } catch (error) {
      throw toServiceError(error, 'Media service unavailable');
    }
  },

  get: async (id: string) => {
    try {
      const client = serviceClient();
      const media = await getMediaRow(id, client);
      const variants = await listMediaVariants(id, client);
      const references = await findMediaReferences(id, client);
      return { ...media, variants, referencedByArticles: references.length };
    } catch (error) {
      throw toServiceError(error, 'Media service unavailable');
    }
  },

  upload: async (
    actorId: string,
    input: {
      fileName: string;
      mimeType?: string;
      contentBase64: string;
      altText?: string | null;
      caption?: string | null;
      credit?: string | null;
      entityType?: string;
      idempotencyKey?: string | null;
    },
    requestId?: string,
  ) => {
    try {
      const bytes = decodeBase64(input.contentBase64);
      const result = await mediaService.upload(
        actorId,
        {
          fileName: input.fileName,
          mimeType: input.mimeType,
          bytes,
          altText: input.altText ?? null,
          caption: input.caption ?? null,
          credit: input.credit ?? null,
          entityType: input.entityType,
          idempotencyKey: input.idempotencyKey ?? null,
        },
        requestId,
      );
      // mediaService already audited media.upload; add the admin-layer entry.
      await writeAdminAudit({
        userId: actorId,
        action: 'media.upload.admin',
        resource: 'media',
        resourceId: String((result.media as unknown as Record<string, unknown>).id),
        newData: { fileName: input.fileName, deduped: result.deduped },
      });
      return result;
    } catch (error) {
      throw toServiceError(error, 'Media service unavailable');
    }
  },

  update: async (actorId: string, id: string, patch: { altText?: string | null; caption?: string | null; credit?: string | null }) => {
    try {
      const after = await mediaService.updateMetadata(actorId, id, patch);
      await writeAdminAudit({ userId: actorId, action: 'media.update.admin', resource: 'media', resourceId: id, newData: patch });
      return after;
    } catch (error) {
      throw toServiceError(error, 'Media service unavailable');
    }
  },

  remove: async (actorId: string, id: string) => {
    try {
      const result = await mediaService.remove(actorId, id);
      await writeAdminAudit({ userId: actorId, action: 'media.delete.admin', resource: 'media', resourceId: id });
      return result;
    } catch (error) {
      throw toServiceError(error, 'Media service unavailable');
    }
  },
};
