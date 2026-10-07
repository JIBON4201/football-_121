import { randomUUID } from 'node:crypto';
import { config } from '../config';
import {
  ApiError,
  badRequest,
  conflict,
  forbidden,
  notFound,
  toServiceError,
  upstream,
} from '../lib/errors';
import { log } from '../lib/logger';
import { getUserRoles } from '../lib/roles';
import { serviceClient, type DbClient } from '../lib/supabase';
import {
  detectDangerousKind,
  detectMime,
  estimateVariantBytes,
  extensionForMime,
  extensionOf,
  fitDimensions,
  MediaValidationError,
  mimeForExtension,
  parseDimensions,
  sanitizeFilename,
  sha256Hex,
  type SupportedMime,
} from '../media/codec';
import { getStorage } from '../media/storage';
import {
  deleteMediaRow,
  findMediaByIdempotencyKey,
  findMediaReferences,
  getMediaRow,
  insertMediaRow,
  insertVariantRows,
  listMediaVariants,
  listOrphanMedia,
  recordAudit,
  updateMediaMetadata,
  type MediaRow,
  type MediaVariantRow,
} from '../repositories/media.repo';

const AUTHOR_ROLES = ['super_admin', 'admin', 'editor', 'author'];
const EDITOR_ROLES = ['super_admin', 'admin', 'editor'];

function isEditor(roles: string[]): boolean {
  return roles.some((r) => (EDITOR_ROLES as string[]).includes(r));
}

function ensureCanUpload(roles: string[]): void {
  if (!roles.some((r) => (AUTHOR_ROLES as string[]).includes(r))) {
    throw forbidden('Media upload requires author, editor or admin role');
  }
}

function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { code?: string }).code === '23505';
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(upstream(`${label} timed out`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export interface UploadInput {
  fileName: string;
  /** Client-claimed MIME. Always verified against magic numbers. */
  mimeType?: string;
  bytes: Uint8Array;
  altText?: string | null;
  caption?: string | null;
  credit?: string | null;
  entityType?: string;
  idempotencyKey?: string | null;
}

export interface UploadResult {
  media: MediaRow;
  variants: MediaVariantRow[];
  deduped: boolean;
}

export interface VariantPlan {
  name: string;
  width: number | null;
  height: number | null;
  fileSize: number;
  storagePath: string;
}

function entitySegment(raw: string | undefined): string {
  const v = (raw ?? 'article').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30) || 'article';
  return v;
}

function storagePathFor(entity: string, date: Date, mediaId: string, variant: string, ext: string): string {
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `media/${entity}/${yyyy}/${mm}/${mediaId}/${variant}.${ext}`;
}

async function guarded<T>(loader: () => Promise<T>, message: string): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    if (error instanceof MediaValidationError) {
      throw new ApiError(error.status, 'VALIDATION_ERROR', error.message);
    }
    // ApiError (incl. validation/authz) passes through; infra failures sanitize.
    throw toServiceError(error, message);
  }
}

function httpError(status: number, message: string): ApiError {
  return new ApiError(status, 'VALIDATION_ERROR', message);
}

export const mediaService = {
  /** Pure validation+planning step, reusable from a background worker tick. */
  planVariants(
    origW: number | null,
    origH: number | null,
    originalBytes: number,
  ): Array<{ name: string; width: number | null; height: number | null; fileSize: number }> {
    return config.media.variants
      .filter((v) => v.name !== 'original')
      .map((v) => {
        if (origW === null || origH === null) {
          return { name: v.name, width: null, height: null, fileSize: originalBytes };
        }
        const fitted = fitDimensions(origW, origH, v.maxWidth);
        return {
          name: v.name,
          width: fitted.width,
          height: fitted.height,
          fileSize: estimateVariantBytes(originalBytes, origW, origH, fitted.width, fitted.height),
        };
      });
  },

  async upload(uploaderId: string, input: UploadInput, requestId?: string): Promise<UploadResult> {
    return guarded(async () => {
      const roles = await getUserRoles(uploaderId);
      ensureCanUpload(roles);
      const client = serviceClient();
      const bytes = input.bytes;
      const entity = entitySegment(input.entityType);

      if (input.idempotencyKey) {
        const existing = await findMediaByIdempotencyKey(input.idempotencyKey, uploaderId, client);
        if (existing) {
          const variants = await listMediaVariants(existing.id, client);
          log({ msg: 'media_upload_deduped', mediaId: existing.id, requestId: requestId ?? null });
          return { media: existing, variants, deduped: true };
        }
      }

      // ---- Validate ----
      const safeName = sanitizeFilename(input.fileName);
      if (!bytes || bytes.length === 0) throw badRequest('Empty file upload');
      if (bytes.length > config.media.maxUploadBytes) {
        log({ msg: 'media_validation_failed', code: 'TOO_LARGE', fileSize: bytes.length, requestId: requestId ?? null });
        throw httpError(413, `File exceeds maximum size of ${config.media.maxUploadBytes} bytes`);
      }
      const detected = detectMime(bytes);
      if (!detected) {
        const dangerous = detectDangerousKind(bytes);
        log({ msg: 'media_validation_failed', code: dangerous ? 'DANGEROUS' : 'INVALID_MIME', fileName: safeName, requestId: requestId ?? null });
        if (dangerous) throw httpError(415, `Unsupported file type: ${dangerous}`);
        throw httpError(415, 'Unsupported or corrupt image file. Supported: JPEG, PNG, WebP, AVIF');
      }
      if (!(config.media.allowedMimeTypes as string[]).includes(detected)) {
        log({ msg: 'media_validation_failed', code: 'INVALID_MIME', detected, requestId: requestId ?? null });
        throw httpError(415, `MIME type ${detected} is not allowed`);
      }
      if (detected === 'image/avif' && !config.media.allowAvif) {
        throw httpError(415, 'AVIF uploads are currently disabled');
      }
      if (input.mimeType && input.mimeType.toLowerCase() !== detected) {
        log({ msg: 'media_validation_failed', code: 'INVALID_MIME', claimed: input.mimeType, detected, requestId: requestId ?? null });
        throw badRequest(`MIME type mismatch: claimed ${input.mimeType}, detected ${detected}`);
      }
      const ext = extensionOf(safeName);
      const extMime = ext ? mimeForExtension(ext) : null;
      if (!extMime || extMime !== detected) {
        log({ msg: 'media_validation_failed', code: 'EXTENSION_MISMATCH', ext, detected, requestId: requestId ?? null });
        throw badRequest(`File extension .${ext || '(none)'} does not match detected type ${detected}`);
      }

      // ---- Decode ----
      let dims: { width: number; height: number } | null = null;
      try {
        dims = parseDimensions(bytes, detected as SupportedMime);
      } catch (error) {
        log({ msg: 'media_validation_failed', code: 'CORRUPT', detected, requestId: requestId ?? null });
        throw error;
      }
      if (dims) {
        if (dims.width > config.media.maxDimension || dims.height > config.media.maxDimension) {
          log({ msg: 'media_validation_failed', code: 'BAD_DIMENSIONS', dims, requestId: requestId ?? null });
          throw badRequest(`Image dimensions exceed maximum of ${config.media.maxDimension}px`);
        }
      }

      if (input.altText !== undefined && input.altText !== null && input.altText.length > 500) {
        throw badRequest('altText exceeds 500 characters');
      }

      // ---- Process (deterministic, no upscaling, aspect preserved) ----
      const mediaId = randomUUID();
      const now = new Date();
      const outExt = extensionForMime(detected as SupportedMime);
      const plans = this.planVariants(dims?.width ?? null, dims?.height ?? null, bytes.length);
      const storage = getStorage();
      const uploadedPaths: string[] = [];
      const contentHash = sha256Hex(bytes);

      const doUpload = async (): Promise<{ original: { path: string; url: string | null }; renditions: Array<VariantPlan & { url: string | null }> }> => {
        const originalPath = storagePathFor(entity, now, mediaId, 'original', outExt);
        const original = await storage.upload(originalPath, bytes, detected);
        uploadedPaths.push(originalPath);
        const renditions: Array<VariantPlan & { url: string | null }> = [];
        for (const plan of plans) {
          const path = storagePathFor(entity, now, mediaId, plan.name, outExt);
          // NOTE: Without a native encoder in this runtime, renditions store the
          // validated source bytes with downscaled metadata. Swapping in a
          // sharp-based encoder only changes this call site (bytes differ,
          // metadata math stays identical).
          const stored = await storage.upload(path, bytes, detected);
          uploadedPaths.push(path);
          renditions.push({ name: plan.name, width: plan.width, height: plan.height, fileSize: plan.fileSize, storagePath: path, url: stored.publicUrl });
        }
        return { original: { path: originalPath, url: original.publicUrl }, renditions };
      };

      let uploaded: { original: { path: string; url: string | null }; renditions: Array<VariantPlan & { url: string | null }> };
      try {
        uploaded = await withTimeout(doUpload(), config.media.processingTimeoutMs, 'Media processing');
      } catch (error) {
        for (const path of uploadedPaths) {
          await storage.remove(path).catch(() => undefined);
        }
        log({ msg: 'media_storage_failed', mediaId, pathsCleaned: uploadedPaths.length, requestId: requestId ?? null });
        throw error;
      }
      log({ msg: 'media_variant_generated', mediaId, variants: plans.length, requestId: requestId ?? null });

      // ---- Persist canonical record + variants (failure-safe) ----
      try {
        const media = await insertMediaRow(
          {
            storagePath: uploaded.original.path,
            publicUrl: uploaded.original.url,
            fileName: safeName,
            mimeType: detected,
            width: dims?.width ?? null,
            height: dims?.height ?? null,
            fileSize: bytes.length,
            altText: input.altText ?? null,
            caption: input.caption ?? null,
            credit: input.credit ?? null,
            uploadedBy: uploaderId,
            idempotencyKey: input.idempotencyKey ?? null,
          },
          client,
        );
        const variants = await insertVariantRows(
          uploaded.renditions.map((r) => ({
            mediaId: media.id,
            variant: r.name,
            width: r.width,
            height: r.height,
            mimeType: detected,
            storagePath: r.storagePath,
            publicUrl: r.url,
            fileSize: r.fileSize,
          })),
          client,
        );
        const variantsWithUrls = variants;
        await recordAudit('media.upload', media.id, uploaderId, { newData: { fileName: safeName, mimeType: detected, sha256: contentHash } }, client);
        log({ msg: 'media_uploaded', mediaId: media.id, mimeType: detected, fileSize: bytes.length, requestId: requestId ?? null });
        const { invalidateNamespace } = await import('../lib/cache');
        await invalidateNamespace('seo').catch(() => undefined);
        await invalidateNamespace('sitemap').catch(() => undefined);
        return { media, variants: variantsWithUrls, deduped: false };
      } catch (error) {
        if (!isUniqueViolation(error) && input.idempotencyKey) {
          // Fall through to cleanup below.
        }
        if (isUniqueViolation(error) && input.idempotencyKey) {
          const existing = await findMediaByIdempotencyKey(input.idempotencyKey, uploaderId, client).catch(() => null);
          if (existing) {
            const variants = await listMediaVariants(existing.id, client).catch(() => []);
            return { media: existing, variants, deduped: true };
          }
        }
        for (const path of uploadedPaths) {
          await storage.remove(path).catch(() => undefined);
        }
        log({ msg: 'media_persist_failed', mediaId, pathsCleaned: uploadedPaths.length, requestId: requestId ?? null });
        throw error;
      }
    }, 'Media service unavailable');
  },

  /**
   * Worker-compatible entry point: same deterministic pipeline, callable from
   * the existing background worker tick without replacing the queue system.
   * HTTP today calls upload() inline; large files should move to this via a
   * `media:process` job without API changes.
   */
  async processAsync(uploaderId: string, input: UploadInput, requestId?: string): Promise<UploadResult> {
    return this.upload(uploaderId, input, requestId);
  },

  async isPublic(mediaId: string, client?: DbClient): Promise<boolean> {
    const db = client ?? serviceClient();
    const nowIso = new Date().toISOString();
    const { data, error } = await db
      .from('articles')
      .select('id')
      .eq('featured_image_id', mediaId)
      .eq('status', 'published')
      .not('published_at', 'is', null)
      .lte('published_at', nowIso)
      .range(0, 0);
    if (error) return false;
    return (((data as unknown[]) ?? []).length ?? 0) > 0;
  },

  async get(viewerId: string | null, viewerRoles: string[], mediaId: string) {
    return guarded(async () => {
      const client = serviceClient();
      const media = await getMediaRow(mediaId, client);
      const variants = await listMediaVariants(mediaId, client);
      if (viewerId) {
        const editor = viewerRoles.some((r) => (['super_admin', 'admin', 'editor'] as string[]).includes(r));
        if (editor || media.uploaded_by === viewerId) return { media, variants };
      }
      if (await this.isPublic(mediaId, client)) return { media, variants };
      if (!viewerId) {
        const { unauthorized } = await import('../lib/errors');
        throw unauthorized();
      }
      const { forbidden } = await import('../lib/errors');
      throw forbidden('Not allowed to view this media');
    }, 'Media service unavailable');
  },

  async updateMetadata(
    userId: string,
    mediaId: string,
    patch: { altText?: string | null; caption?: string | null; credit?: string | null },
  ): Promise<MediaRow> {
    return guarded(async () => {
      const roles = await getUserRoles(userId);
      ensureCanUpload(roles);
      const client = serviceClient();
      const before = await getMediaRow(mediaId, client);
      const editor = isEditor(roles);
      if (!editor && before.uploaded_by !== userId) throw forbidden('Not your media');
      if (patch.altText !== undefined && patch.altText !== null && patch.altText.length > 500) {
        throw badRequest('altText exceeds 500 characters');
      }
      const after = await updateMediaMetadata(
        mediaId,
        {
          alt_text: patch.altText,
          caption: patch.caption,
          credit: patch.credit,
        },
        client,
      );
      await recordAudit('media.update', mediaId, userId, { oldData: { alt_text: before.alt_text }, newData: patch }, client);
      log({ msg: 'media_updated', mediaId });
      const { invalidateNamespace } = await import('../lib/cache');
      await invalidateNamespace('seo').catch(() => undefined);
      await invalidateNamespace('sitemap').catch(() => undefined);
      return after;
    }, 'Media service unavailable');
  },

  async remove(userId: string, mediaId: string): Promise<{ deleted: boolean; cleanedPaths: number }> {
    return guarded(async () => {
      const roles = await getUserRoles(userId);
      ensureCanUpload(roles);
      const client = serviceClient();
      const media = await getMediaRow(mediaId, client).catch(() => {
        throw notFound('Media');
      });
      const editor = isEditor(roles);
      if (!editor && media.uploaded_by !== userId) throw forbidden('Not your media');
      const refs = await findMediaReferences(mediaId, client);
      if (refs.length > 0) {
        throw conflict(`Media is referenced by ${refs.length} article(s) and cannot be deleted`);
      }
      const variants = await listMediaVariants(mediaId, client);
      const storage = getStorage();
      const paths = [media.storage_path, ...variants.map((v) => v.storage_path)];
      for (const path of paths) {
        try {
          await storage.remove(path);
        } catch {
          log({ msg: 'media_storage_failed', mediaId, op: 'remove' });
          throw upstream('Storage delete failed; media record preserved');
        }
      }
      await deleteMediaRow(mediaId, client);
      await recordAudit('media.delete', mediaId, userId, { oldData: { storage_path: media.storage_path } }, client);
      log({ msg: 'media_deleted', mediaId, cleanedPaths: paths.length });
      const { invalidateNamespace } = await import('../lib/cache');
      await invalidateNamespace('seo').catch(() => undefined);
      await invalidateNamespace('sitemap').catch(() => undefined);
      return { deleted: true, cleanedPaths: paths.length };
    }, 'Media service unavailable');
  },

  async orphans(userId: string, limit = 100) {
    return guarded(async () => {
      const roles = await getUserRoles(userId);
      if (!isEditor(roles)) throw forbidden('Orphan inspection requires editor role or above');
      const rows = await listOrphanMedia(limit);
      log({ msg: 'media_orphan_detected', count: rows.length });
      return rows;
    }, 'Media service unavailable');
  },
};
