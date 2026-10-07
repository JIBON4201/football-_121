import { config } from '../config';
import { serviceClient } from '../lib/supabase';
import { assertSafeStoragePath } from './codec';

export interface StoredObject {
  path: string;
  publicUrl: string | null;
}

export interface MediaStorage {
  upload(path: string, bytes: Uint8Array, mimeType: string): Promise<StoredObject>;
  remove(path: string): Promise<void>;
}

/** Production Supabase Storage backend. Service key never leaves this module. */
export class SupabaseStorageProvider implements MediaStorage {
  constructor(
    private readonly bucket: string = config.media.bucket,
    private readonly cdnBaseUrl: string = config.media.cdnBaseUrl,
  ) {}

  private objectUrl(path: string): string | null {
    if (this.cdnBaseUrl) return `${this.cdnBaseUrl.replace(/\/$/, '')}/${this.bucket}/${path}`;
    const base = (config.supabaseUrl ?? '').replace(/\/$/, '');
    if (!base) return null;
    return `${base}/storage/v1/object/public/${this.bucket}/${path}`;
  }

  async upload(path: string, bytes: Uint8Array, mimeType: string): Promise<StoredObject> {
    assertSafeStoragePath(path);
    const client = serviceClient();
    const { error } = await client.storage.from(this.bucket).upload(path, Buffer.from(bytes) as unknown as File, {
      contentType: mimeType,
      upsert: false,
    });
    if (error) throw new Error(`Storage upload failed: ${String((error as { message?: string }).message ?? error)}`);
    return { path, publicUrl: this.objectUrl(path) };
  }

  async remove(path: string): Promise<void> {
    assertSafeStoragePath(path);
    const client = serviceClient();
    const { error } = await client.storage.from(this.bucket).remove([path]);
    if (error) throw new Error(`Storage remove failed: ${String((error as { message?: string }).message ?? error)}`);
  }
}

/** In-memory backend for tests and local development. */
export class InMemoryStorageProvider implements MediaStorage {
  readonly objects = new Map<string, { bytes: Uint8Array; mimeType: string }>();
  failOnUpload: ((path: string) => boolean) | null = null;
  failOnRemove = false;
  failAllUploads = false;

  constructor(private readonly baseUrl = 'https://cdn.test') {}

  async upload(path: string, bytes: Uint8Array, mimeType: string): Promise<StoredObject> {
    assertSafeStoragePath(path);
    if (this.failAllUploads || this.failOnUpload?.(path)) throw new Error('Storage upload failed (injected)');
    this.objects.set(path, { bytes: bytes.slice(), mimeType });
    return { path, publicUrl: `${this.baseUrl}/${config.media.bucket}/${path}` };
  }

  async remove(path: string): Promise<void> {
    if (this.failOnRemove) throw new Error('Storage remove failed (injected)');
    this.objects.delete(path);
  }

  clear(): void {
    this.objects.clear();
    this.failOnUpload = null;
    this.failOnRemove = false;
    this.failAllUploads = false;
  }
}

let activeStorage: MediaStorage | null = null;

export function getStorage(): MediaStorage {
  if (!activeStorage) activeStorage = new SupabaseStorageProvider();
  return activeStorage;
}

/** Test seam: swap the storage backend. */
export function setStorage(provider: MediaStorage): void {
  activeStorage = provider;
}

export function resetStorage(): void {
  activeStorage = null;
}
