/**
 * Step 3 — Reusable admin audit logging foundation.
 *
 * Records admin actions to public.audit_logs (the existing append-only table;
 * admin_audit_logs is its compatibility view) via the service client.
 * Best-effort: logging failures never fail the admin operation itself.
 *
 * Never logs passwords, tokens, secrets, or authorization material —
 * payloads are deep-redacted before insert.
 */
import { isIP } from 'node:net';
import type { Request } from 'express';
import { log } from '../lib/logger';
import { serviceClient } from '../lib/supabase';
import { ADMIN_BYPASS_USER_ID } from './bypass';

export interface AdminAuditEvent {
  userId: string;
  action: string;
  resource?: string;
  resourceId?: string;
  previousData?: unknown;
  newData?: unknown;
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

const SENSITIVE_KEY = /password|passwd|secret|token|authorization|cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|service[_-]?role|private[_-]?key/i;

/** Deep-clone with sensitive keys replaced by '[REDACTED]'. */
export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactSensitive(entry);
    }
    return out;
  }
  return value;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `entity_id` is a `uuid` column but not every admin resource uses one — roles
 * and permissions are keyed by integer. A non-uuid would fail the whole insert,
 * so anything unparseable is stored as NULL rather than discarding the audit row.
 */
function safeEntityId(value: string | undefined): string | null {
  if (!value) return null;
  const candidate = value.trim();
  return UUID_RE.test(candidate) ? candidate : null;
}

/**
 * `audit_logs.ip_address` is an `inet` column, so a single malformed
 * `x-forwarded-for` would make every insert fail and silently disable auditing.
 * Anything that is not a valid IP is dropped rather than trusted.
 */
function safeIp(value: string | undefined): string | null {
  if (!value) return null;
  const candidate = value.trim();
  return isIP(candidate) ? candidate : null;
}

/**
 * Insert one audit row. Resolves false (never throws) on any failure.
 *
 * The synthetic bypass identity is not a real `profiles` row, and `user_id`
 * references `profiles(user_id)`, so inserting it would raise a foreign-key
 * violation on every single write. It is stored as NULL instead: the row keeps
 * its action, entity, IP, user agent and timestamp. A NULL `user_id` is
 * unambiguous because a real admin write always has an actor.
 */
export async function writeAdminAudit(event: AdminAuditEvent): Promise<boolean> {
  if (!event.userId || !event.action) return false;
  const bypassActor = event.userId === ADMIN_BYPASS_USER_ID;
  try {
    const { error } = (await serviceClient()
      .from('audit_logs')
      .insert({
        user_id: bypassActor ? null : event.userId,
        action: event.action,
        entity_type: event.resource ?? null,
        entity_id: safeEntityId(event.resourceId),
        old_data: event.previousData === undefined ? null : (redactSensitive(event.previousData) as never),
        new_data: event.newData === undefined ? null : (redactSensitive(event.newData) as never),
        ip_address: safeIp(event.ip),
        user_agent: event.userAgent ?? null,
      })
      .select()) as unknown as { error: { code?: string; message?: string } | null };
    if (error) {
      // The reason must be logged. Without it a systematic failure (bad FK,
      // malformed inet, oversized action) looks identical to "nothing audited".
      log({
        msg: 'admin audit write failed',
        action: event.action,
        code: error.code ?? 'unknown',
        reason: error.message ?? 'unknown',
      });
      return false;
    }
    return true;
  } catch (error) {
    log({
      msg: 'admin audit write threw',
      action: event.action,
      reason: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/** Build an audit event from the request (no credential capture). */
export function adminAuditFromRequest(
  req: Request,
  action: string,
  resource?: string,
  resourceId?: string,
): AdminAuditEvent {
  const userId = req.admin?.userId ?? req.user?.id ?? '';
  const forwarded = req.headers['x-forwarded-for'];
  const ip =
    (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim() ??
    req.ip ??
    undefined;
  return {
    userId,
    action,
    resource,
    resourceId,
    ip,
    userAgent: req.headers['user-agent'] ?? undefined,
    requestId: req.requestId,
  };
}
