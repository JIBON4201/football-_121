import { createHash } from 'node:crypto';

export const SUPPORTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;

export type SupportedMime = (typeof SUPPORTED_MIME_TYPES)[number];

const EXT_TO_MIME: Record<string, SupportedMime> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
};

const MIME_TO_EXT: Record<SupportedMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

const DANGEROUS_EXTENSIONS = new Set([
  'exe', 'dll', 'bat', 'cmd', 'sh', 'js', 'mjs', 'html', 'htm', 'svg',
  'php', 'py', 'rb', 'pl', 'jar', 'war', 'msi', 'com', 'scr', 'ps1',
]);

export class MediaValidationError extends Error {
  readonly code: 'INVALID_MIME' | 'EXTENSION_MISMATCH' | 'TOO_LARGE' | 'BAD_DIMENSIONS' | 'CORRUPT' | 'DANGEROUS' | 'INVALID_NAME';
  readonly status: number;
  constructor(code: MediaValidationError['code'], message: string, status = 400) {
    super(message);
    this.name = 'MediaValidationError';
    this.code = code;
    this.status = status;
  }
}

/** Strip directories, control chars and dangerous names. Never returns a path. */
export function sanitizeFilename(raw: string): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 255) {
    throw new MediaValidationError('INVALID_NAME', 'Invalid file name');
  }
  if (raw.includes('\0')) throw new MediaValidationError('INVALID_NAME', 'Invalid file name');
  // Take only the final segment (kills Foo/Bar, C:\, ../../ traversals).
  const base = raw.replace(/\\/g, '/').split('/').pop() ?? '';
  const cleaned = base
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim()
    .replace(/^\.+/, '');
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw new MediaValidationError('INVALID_NAME', 'Invalid file name');
  }
  const dot = cleaned.lastIndexOf('.');
  const namePart = (dot > 0 ? cleaned.slice(0, dot) : cleaned)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 80) || 'image';
  const ext = (dot > 0 ? cleaned.slice(dot + 1) : '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10);
  if (DANGEROUS_EXTENSIONS.has(ext)) {
    throw new MediaValidationError('DANGEROUS', `File extension .${ext} is not allowed`);
  }
  return ext ? `${namePart}.${ext}` : namePart;
}

export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

/** Detect the true type from magic numbers. Never trusts client MIME. */
export function detectMime(bytes: Uint8Array): SupportedMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
  }
  return null;
}

/** Best-effort detection of non-image/dangerous payloads for clear errors. */
export function detectDangerousKind(bytes: Uint8Array): string | null {
  if (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) return 'executable (MZ)';
  if (bytes.length >= 4 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) return 'executable (ELF)';
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'document (PDF)';
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) return 'archive (ZIP)';
  if (bytes.length >= 6) {
    const head = String.fromCharCode(...bytes.slice(0, 6));
    if (head === 'GIF87a' || head === 'GIF89a') return 'GIF (unsupported)';
  }
  const sampleLen = Math.min(bytes.length, 512);
  let text = '';
  for (let i = 0; i < sampleLen; i += 1) {
    const b = bytes[i];
    if (b === 0) return null;
    text += String.fromCharCode(b);
  }
  const lowered = text.trimStart().toLowerCase();
  if (lowered.startsWith('<svg') || lowered.startsWith('<?xml')) return 'SVG/XML (unsupported)';
  if (lowered.startsWith('<html') || lowered.startsWith('<!doctype html')) return 'HTML (unsupported)';
  if (lowered.startsWith('#!') || lowered.includes('<script')) return 'script (blocked)';
  return null;
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000 + bytes[offset + 2] * 0x100 + bytes[offset + 3]) >>> 0;
}

function parsePngDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 33) throw new MediaValidationError('CORRUPT', 'Truncated PNG file', 422);
  // After 8-byte signature: 4-byte length + 'IHDR' + 13 bytes (width, height...).
  const type = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (type !== 'IHDR') throw new MediaValidationError('CORRUPT', 'Corrupt PNG: missing IHDR', 422);
  const width = readU32BE(bytes, 16);
  const height = readU32BE(bytes, 20);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new MediaValidationError('CORRUPT', 'Corrupt PNG dimensions', 422);
  }
  return { width, height };
}

function parseJpegDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new MediaValidationError('CORRUPT', 'Corrupt JPEG file', 422);
  }
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) throw new MediaValidationError('CORRUPT', 'Corrupt JPEG structure', 422);
    const marker = bytes[offset + 1];
    // Standalone markers without length.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    if (offset + 4 > bytes.length) break;
    const length = bytes[offset + 2] * 256 + bytes[offset + 3];
    if (length < 2) throw new MediaValidationError('CORRUPT', 'Corrupt JPEG segment', 422);
    const isSOF = (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc);
    if (isSOF) {
      if (offset + 9 >= bytes.length) throw new MediaValidationError('CORRUPT', 'Truncated JPEG frame', 422);
      const height = bytes[offset + 5] * 256 + bytes[offset + 6];
      const width = bytes[offset + 7] * 256 + bytes[offset + 8];
      if (width <= 0 || height <= 0) throw new MediaValidationError('CORRUPT', 'Corrupt JPEG dimensions', 422);
      return { width, height };
    }
    if (marker === 0xda) break; // Start of scan: no more headers.
    offset += 2 + length;
  }
  throw new MediaValidationError('CORRUPT', 'Unable to decode JPEG dimensions', 422);
}

function parseWebpDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 30) throw new MediaValidationError('CORRUPT', 'Truncated WebP file', 422);
  const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (chunk === 'VP8 ') {
    if (bytes.length < 30) throw new MediaValidationError('CORRUPT', 'Truncated WebP frame', 422);
    const w = bytes[26] | (bytes[27] << 8);
    const h = bytes[28] | (bytes[29] << 8);
    const width = w & 0x3fff;
    const height = h & 0x3fff;
    if (width <= 0 || height <= 0) throw new MediaValidationError('CORRUPT', 'Corrupt WebP dimensions', 422);
    return { width, height };
  }
  if (chunk === 'VP8L') {
    if (bytes.length < 25) throw new MediaValidationError('CORRUPT', 'Truncated WebP frame', 422);
    const b0 = bytes[21];
    const b1 = bytes[22];
    const b2 = bytes[23];
    const b3 = bytes[24];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    if (width <= 0 || height <= 0) throw new MediaValidationError('CORRUPT', 'Corrupt WebP dimensions', 422);
    return { width, height };
  }
  if (chunk === 'VP8X') {
    if (bytes.length < 30) throw new MediaValidationError('CORRUPT', 'Truncated WebP frame', 422);
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    if (width <= 0 || height <= 0) throw new MediaValidationError('CORRUPT', 'Corrupt WebP dimensions', 422);
    return { width, height };
  }
  throw new MediaValidationError('CORRUPT', 'Unsupported WebP chunk', 422);
}

/**
 * Decode intrinsic dimensions. AVIF dimension parsing requires a full
 * BMFF box walk; treat dims as unknown (null) and let callers enforce
 * size-only guards. Never throws for AVIF structure.
 */
export function parseDimensions(bytes: Uint8Array, mime: SupportedMime): { width: number; height: number } | null {
  switch (mime) {
    case 'image/png':
      return parsePngDimensions(bytes);
    case 'image/jpeg':
      return parseJpegDimensions(bytes);
    case 'image/webp':
      return parseWebpDimensions(bytes);
    case 'image/avif':
      return null;
    default:
      return null;
  }
}

export function mimeForExtension(ext: string): SupportedMime | null {
  return EXT_TO_MIME[ext.toLowerCase()] ?? null;
}

export function extensionForMime(mime: SupportedMime): string {
  return MIME_TO_EXT[mime];
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Downscale-only fit: never upscale, preserve aspect ratio. */
export function fitDimensions(origW: number, origH: number, maxWidth: number): { width: number; height: number } {
  if (maxWidth <= 0 || origW <= maxWidth) return { width: origW, height: origH };
  const scale = maxWidth / origW;
  return { width: maxWidth, height: Math.max(1, Math.round(origH * scale)) };
}

/** Proportional byte estimate for rendition metadata until a real encoder lands. */
export function estimateVariantBytes(originalBytes: number, origW: number, origH: number, w: number, h: number): number {
  if (origW <= 0 || origH <= 0) return originalBytes;
  const ratio = (w * h) / (origW * origH);
  return Math.max(1, Math.round(originalBytes * Math.min(1, ratio)));
}

/** Storage paths stay predictable and opaque: no FS details leak. */
export function assertSafeStoragePath(path: string): void {
  if (typeof path !== 'string' || path.length === 0 || path.length > 500) {
    throw new MediaValidationError('INVALID_NAME', 'Invalid storage path');
  }
  if (path.includes('\0') || path.includes('\\') || /(^|\/)\.\.(\/|$)/.test(path)) {
    throw new MediaValidationError('INVALID_NAME', 'Invalid storage path');
  }
  if (!path.startsWith('media/')) throw new MediaValidationError('INVALID_NAME', 'Invalid storage path');
}
