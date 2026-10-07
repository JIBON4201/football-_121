import { beforeEach, describe, expect, it, vi } from 'vitest';
import { writeAdminAudit } from '../src/admin/audit';
import { ADMIN_BYPASS_USER_ID } from '../src/admin/bypass';
import { installTestEnv } from './helpers';
import type { FakeClient } from './fake';

/**
 * Audit-write resilience.
 *
 * `audit_logs.user_id` references `profiles(user_id)`, `entity_id` is a `uuid`
 * column and `ip_address` is an `inet` column. Three separate shapes of admin
 * write would therefore fail the insert — and because the helper is
 * best-effort, every one of them was silently swallowed, leaving an empty audit
 * table with no indication anything was wrong. Each test below pins one of
 * those paths so the failure cannot come back unnoticed.
 */
describe('admin audit write resilience', () => {
  let fake: FakeClient;

  beforeEach(() => {
    ({ fake } = installTestEnv());
    fake.store.audit_logs = [];
  });

  it('stores the synthetic bypass actor as NULL rather than violating the FK', async () => {
    const ok = await writeAdminAudit({
      userId: ADMIN_BYPASS_USER_ID,
      action: 'venues.create',
      resource: 'venues',
      resourceId: '11111111-2222-4333-8444-555555555555',
    });
    expect(ok).toBe(true);
    const row = fake.store.audit_logs[0] as Record<string, unknown>;
    // The sentinel is not a profiles row, so it must never be written verbatim.
    expect(row.user_id).toBeNull();
    expect(row.action).toBe('venues.create');
    expect(row.entity_type).toBe('venues');
  });

  it('keeps a real admin actor attached to the row', async () => {
    const ok = await writeAdminAudit({ userId: 'user-1', action: 'teams.update', resource: 'teams' });
    expect(ok).toBe(true);
    const row = fake.store.audit_logs[0] as Record<string, unknown>;
    expect(row.user_id).toBe('user-1');
  });

  it('drops a malformed x-forwarded-for instead of failing the insert', async () => {
    // ip_address is `inet`; a spoofed/garbage XFF would raise 22P02 and, before
    // the guard, silently disable auditing for the whole request.
    const ok = await writeAdminAudit({
      userId: 'user-1',
      action: 'matches.update',
      resource: 'matches',
      ip: 'not-an-ip',
    });
    expect(ok).toBe(true);
    const row = fake.store.audit_logs[0] as Record<string, unknown>;
    expect(row.ip_address).toBeNull();
  });

  it('accepts a real IPv4 and IPv6 address', async () => {
    await writeAdminAudit({ userId: 'user-1', action: 'a', ip: '203.0.113.7' });
    await writeAdminAudit({ userId: 'user-1', action: 'b', ip: '2001:db8::1' });
    expect((fake.store.audit_logs[0] as Record<string, unknown>).ip_address).toBe('203.0.113.7');
    expect((fake.store.audit_logs[1] as Record<string, unknown>).ip_address).toBe('2001:db8::1');
  });

  it('drops a non-uuid entity_id (roles are integer-keyed) instead of failing', async () => {
    // Roles and permissions use serial ids; entity_id is uuid, so writing "3"
    // would raise 22P02 and lose the audit row for every role change.
    const ok = await writeAdminAudit({
      userId: 'user-1',
      action: 'roles.manage',
      resource: 'roles',
      resourceId: '3',
    });
    expect(ok).toBe(true);
    const row = fake.store.audit_logs[0] as Record<string, unknown>;
    expect(row.entity_id).toBeNull();
    expect(row.action).toBe('roles.manage');
  });

  it('still records a uuid entity_id', async () => {
    await writeAdminAudit({
      userId: 'user-1',
      action: 'teams.delete',
      resource: 'teams',
      resourceId: '11111111-2222-4333-8444-555555555555',
    });
    expect((fake.store.audit_logs[0] as Record<string, unknown>).entity_id).toBe(
      '11111111-2222-4333-8444-555555555555',
    );
  });

  it('logs the reason when the insert fails, so a systematic failure is visible', async () => {
    const logSpy = vi.spyOn(await import('../src/lib/logger'), 'log').mockImplementation(() => {});
    // Force a rejection by making the client throw.
    const { setClientFactories } = await import('../src/lib/supabase');
    const boom = () => {
      throw new Error('connection refused');
    };
    setClientFactories({ service: boom, anon: boom });
    const ok = await writeAdminAudit({ userId: 'user-1', action: 'teams.create' });
    expect(ok).toBe(false);
    const entry = logSpy.mock.calls.map((c) => c[0]).find((c) => c && c.msg === 'admin audit write threw');
    expect(entry).toBeDefined();
    expect(String(entry.reason)).toContain('connection refused');
    logSpy.mockRestore();
  });

  it('refuses to write an event with no actor or action', async () => {
    expect(await writeAdminAudit({ userId: '', action: 'x' })).toBe(false);
    expect(await writeAdminAudit({ userId: 'user-1', action: '' })).toBe(false);
    expect(fake.store.audit_logs).toHaveLength(0);
  });
});
