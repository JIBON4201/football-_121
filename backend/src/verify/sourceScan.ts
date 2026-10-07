/**
 * Static analysis helpers for Step 40: environment-variable inventory and
 * secret-leak scanning across source files and the built frontend bundle.
 *
 * Detection patterns are assembled from fragments at runtime so this file's own
 * source never matches itself (a scanner that flags its own patterns is worse
 * than no scanner).
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export interface DiscoveredFile {
  /** Path relative to the repo root, using forward slashes. */
  path: string;
  absolute: string;
  size: number;
}

const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.vercel',
]);

const TEXT_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.css', '.md', '.yml', '.yaml', '.env', '.example'];

function isTextFile(path: string): boolean {
  const lower = path.toLowerCase();
  if (lower.endsWith('.example')) return true;
  if (lower.includes('.env')) return true;
  return TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Recursively collect candidate files under `root`, skipping vendor/artifact dirs. */
export function collectFiles(root: string, maxBytes = 8_000_000): DiscoveredFile[] {
  if (!existsSync(root)) return [];
  const out: DiscoveredFile[] = [];
  const stack: string[] = [root];

  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const absolute = join(current, entry);
      let stats;
      try {
        stats = statSync(absolute);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry)) continue;
        stack.push(absolute);
        continue;
      }
      if (!stats.isFile()) continue;
      if (stats.size > maxBytes) continue;
      if (!isTextFile(absolute)) continue;
      out.push({
        path: relative(root, absolute).split(sep).join('/'),
        absolute,
        size: stats.size,
      });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export interface EnvVarUse {
  name: string;
  file: string;
  /** How the variable was referenced. */
  via: 'process.env' | 'config-helper' | 'dynamic-prefix';
  line: number;
}

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i += 1) {
    if (content.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

/**
 * Enumerate every environment variable the backend source actually reads.
 * Covers direct `process.env.X`, the num/csv/bool config helpers, and the
 * `${PREFIX}_${SUFFIX}` dynamic family used by the provider layer.
 *
 * `skipFiles` excludes modules that legitimately contain the *patterns* rather
 * than real reads — this scanner's own detection regexes and doc comments would
 * otherwise register as environment variables named `X`. Matching is done on
 * path suffix so callers need not know how the scan root was relativized.
 */
export function inventoryEnvVars(
  files: DiscoveredFile[],
  skipFiles: readonly string[] = [],
): EnvVarUse[] {
  const skip = skipFiles.map((path) => path.replace(/\\/g, '/').toLowerCase());
  const uses = new Map<string, EnvVarUse>();

  const record = (use: EnvVarUse): void => {
    const key = `${use.name}@${use.file}`;
    if (!uses.has(key)) uses.set(key, use);
  };

  const patterns: { regex: RegExp; via: EnvVarUse['via']; name: (m: RegExpExecArray) => string }[] = [
    { regex: /process\.env\.([A-Z][A-Z0-9_]*)/g, via: 'process.env', name: (m) => m[1] },
    { regex: /\b(?:num|csv|bool)\(\s*'([A-Z][A-Z0-9_]*)'/g, via: 'config-helper', name: (m) => m[1] },
  ];

  for (const file of files) {
    const normalized = file.path.replace(/\\/g, '/').toLowerCase();
    if (skip.some((pattern) => normalized.endsWith(pattern))) continue;
    let content: string;
    try {
      content = readFileSync(file.absolute, 'utf8');
    } catch {
      continue;
    }
    for (const { regex, via, name } of patterns) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        record({ name: name(match), file: file.path, via, line: lineOf(content, match.index) });
      }
    }
    // Dynamic provider family: process.env[`${prefix}_${suffix}`]
    if (/process\.env\[`\$\{prefix\}_\$\{suffix\}`\]/.test(content)) {
      record({ name: '<PREFIX>_BASE_URL', file: file.path, via: 'dynamic-prefix', line: 1 });
    }
  }

  return [...uses.values()].sort((a, b) => a.name.localeCompare(b.name) || a.file.localeCompare(b.file));
}

/**
 * Expand the dynamic `<PREFIX>_…` family into concrete names using the suffix
 * list declared in the provider config module.
 */
export function expandProviderFamily(files: DiscoveredFile[], prefix = 'PROVIDER'): string[] {
  const suffixes = ['BASE_URL', 'API_KEY', 'KEY_HEADER', 'TIMEOUT_MS', 'MAX_RETRIES', 'REQUESTS_PER_MINUTE', 'MAX_RESPONSE_BYTES', 'ENABLED'];
  const declared = files.some((file) => {
    if (!file.path.endsWith('providers/config.ts')) return false;
    try {
      const content = readFileSync(file.absolute, 'utf8');
      return suffixes.every((suffix) => content.includes(`get('${suffix}')`));
    } catch {
      return false;
    }
  });
  return declared ? suffixes.map((suffix) => `${prefix}_${suffix}`) : [];
}

export interface SecretHit {
  /** Which detector fired. */
  detector: string;
  file: string;
  line: number;
  severity: 'BLOCKER' | 'HIGH' | 'MEDIUM';
  /** Redacted excerpt — never the raw secret. */
  excerpt: string;
}

interface Detector {
  name: string;
  severity: 'BLOCKER' | 'HIGH' | 'MEDIUM';
  regex: RegExp;
}

function redact(value: string): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= 12) return `${collapsed.slice(0, 4)}***`;
  return `${collapsed.slice(0, 8)}***${collapsed.slice(-2)} (len=${collapsed.length})`;
}

/**
 * High-signal credential detectors. Patterns are built from fragments so this
 * module's own source code does not trip them.
 */
function buildDetectors(): Detector[] {
  const jwt = ['ey', 'JhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'].join('');
  const sbSecret = ['sb_', 'secret_'].join('');
  const sbLegacy = ['sb_', 'publishable_'].join('');
  return [
    // Supabase service-role JWT (the key that must never reach a browser).
    { name: 'supabase-service-jwt', severity: 'BLOCKER', regex: new RegExp(`${jwt}[A-Za-z0-9_-]{40,}`, 'g') },
    // New-style Supabase secret key.
    { name: 'supabase-secret-key', severity: 'BLOCKER', regex: new RegExp(`${sbSecret}[A-Za-z0-9_-]{20,}`, 'g') },
    { name: 'supabase-publishable-key', severity: 'MEDIUM', regex: new RegExp(`${sbLegacy}[A-Za-z0-9_-]{20,}`, 'g') },
    { name: 'aws-access-key', severity: 'BLOCKER', regex: /AKIA[0-9A-Z]{16}/g },
    { name: 'google-api-key', severity: 'HIGH', regex: /AIza[0-9A-Za-z_-]{35}/g },
    { name: 'github-token', severity: 'BLOCKER', regex: /gh[pousr]_[0-9A-Za-z]{36,}/g },
    { name: 'slack-token', severity: 'BLOCKER', regex: /xox[abprs]-[0-9A-Za-z-]{10,}/g },
    { name: 'stripe-live-key', severity: 'BLOCKER', regex: /sk_live_[0-9A-Za-z]{16,}/g },
    { name: 'private-key-block', severity: 'BLOCKER', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  ];
}

/** Scan files for credential material. Never returns raw secret values. */
export function scanForSecrets(files: DiscoveredFile[]): SecretHit[] {
  const detectors = buildDetectors();
  const hits: SecretHit[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file.absolute, 'utf8');
    } catch {
      continue;
    }
    for (const detector of detectors) {
      detector.regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = detector.regex.exec(content)) !== null) {
        hits.push({
          detector: detector.name,
          file: file.path,
          line: lineOf(content, match.index),
          severity: detector.severity,
          excerpt: redact(match[0]),
        });
      }
    }
  }
  return hits;
}

/**
 * Detect code that reads a server-only variable from code that can reach the
 * browser (client components / NEXT_PUBLIC_ prefixed reads).
 */
export interface ClientSecretUse {
  file: string;
  line: number;
  variable: string;
}

const SERVER_ONLY = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'PROVIDER_API_KEY',
  'SUPABASE_URL',
];

export function findClientSideSecretUse(files: DiscoveredFile[]): ClientSecretUse[] {
  const out: ClientSecretUse[] = [];
  for (const file of files) {
    // Only frontend code can reach the browser.
    if (!file.path.startsWith('frontend/src')) continue;
    let content: string;
    try {
      content = readFileSync(file.absolute, 'utf8');
    } catch {
      continue;
    }
    for (const variable of SERVER_ONLY) {
      const regex = new RegExp(`process\\.env\\.${variable}\\b`, 'g');
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        out.push({ file: file.path, line: lineOf(content, match.index), variable });
      }
    }
  }
  return out;
}

/** Read a .env-style file into a map. Missing files yield an empty map. */
export function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readEnvLines(path)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    out[key] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

/**
 * Keys documented in an .env.example file, including deliberately
 * commented-out entries (`# ADMIN_TOKEN=`). A commented key is documented but
 * unset, so it must not count as a configuration gap.
 */
export function parseEnvExampleKeys(path: string): string[] {
  if (!existsSync(path)) return [];
  const keys = new Set<string>();
  for (const raw of readEnvLines(path)) {
    const trimmed = raw.trim();
    const withoutHash = trimmed.startsWith('#') ? trimmed.slice(1).trim() : trimmed;
    if (withoutHash === '') continue;
    const eq = withoutHash.indexOf('=');
    if (eq <= 0) continue;
    const key = withoutHash.slice(0, eq).trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) keys.add(key);
  }
  return [...keys].sort();
}

function readEnvLines(path: string): string[] {
  try {
    return readFileSync(path, 'utf8').split(/\r?\n/);
  } catch {
    return [];
  }
}