import { describe, expect, it } from 'vitest';
import { isValidSlug, parsePositiveInt, sanitizeText, toSafeHref } from '@/lib/validation';

describe('route safety + input validation', () => {
  it('accepts backend-compatible slugs and rejects attacks', () => {
    expect(isValidSlug('fc-example')).toBe(true);
    expect(isValidSlug('a')).toBe(true);
    expect(isValidSlug('')).toBe(false);
    expect(isValidSlug("'; DROP TABLE")).toBe(false);
    expect(isValidSlug('../secret')).toBe(false);
    expect(isValidSlug('a/b')).toBe(false);
    expect(isValidSlug('x'.repeat(301))).toBe(false);
  });

  it('blocks unsafe URLs (xss, open redirect, foreign origins)', () => {
    expect(toSafeHref('/news/big-win')).toBe('/news/big-win');
    expect(toSafeHref('javascript:alert(1)')).toBeNull();
    expect(toSafeHref('data:text/html,x')).toBeNull();
    expect(toSafeHref('//evil.example.com/x')).toBeNull();
    expect(toSafeHref('https://evil.example.com/x')).toBeNull();
    expect(toSafeHref('/x y')).toBeNull();
    expect(toSafeHref(null)).toBeNull();
  });

  it('strips markup from text', () => {
    expect(sanitizeText('<script>alert(1)</script>hello')).not.toContain('<script>');
    expect(sanitizeText('<script>alert(1)</script>hello')).toContain('hello');
  });

  it('parses pagination safely', () => {
    expect(parsePositiveInt('3', 1)).toBe(3);
    expect(parsePositiveInt('0', 1)).toBe(1);
    expect(parsePositiveInt('abc', 2)).toBe(2);
    expect(parsePositiveInt(['4', '5'], 1)).toBe(4);
  });
});
