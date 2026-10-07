import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatDateTime,
  formatKickoff,
  formatKickoffDhaka,
  formatRelative,
  parseUtc,
} from '@/lib/dates';

describe('centralized date/time (UTC-first)', () => {
  it('parses UTC consistently and rejects garbage', () => {
    expect(parseUtc('2026-08-01T15:00:00.000Z')?.toISOString()).toBe('2026-08-01T15:00:00.000Z');
    expect(parseUtc('not-a-date')).toBeNull();
    expect(parseUtc(null)).toBeNull();
  });

  it('formats identically for a fixed zone (deterministic)', () => {
    const first = formatDateTime('2026-08-01T15:00:00.000Z', 'en-GB', { timeZone: 'UTC' });
    const second = formatDateTime('2026-08-01T15:00:00.000Z', 'en-GB', { timeZone: 'UTC' });
    expect(first).toBe(second);
    expect(first).toContain('2026');
    expect(formatDate('2026-08-01T15:00:00.000Z', 'en-GB', 'UTC')).toContain('2026');
  });

  it('distinguishes local kickoff from UTC', () => {
    const kickoff = formatKickoff('2026-08-01T15:00:00.000Z', 'en-GB', 'Asia/Dhaka');
    expect(kickoff.utc).toContain('15:00');
    expect(kickoff.local).not.toBe(kickoff.utc);
    const dhaka = formatKickoffDhaka('2026-08-01T15:00:00.000Z');
    expect(dhaka.local).toContain('21:00');
  });

  it('formats relative times from a fixed clock', () => {
    const now = Date.parse('2026-08-02T15:00:00.000Z');
    expect(formatRelative('2026-08-02T14:59:30.000Z', now)).toBe('just now');
    expect(formatRelative('2026-08-02T14:00:00.000Z', now)).toBe('1h ago');
    expect(formatRelative('2026-08-03T15:00:00.000Z', now)).toBe('upcoming');
    expect(formatRelative(null, now)).toBe('');
  });
});
