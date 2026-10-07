import { describe, expect, it } from 'vitest';
import { normalizePathname } from '@/middleware';
import { siteConfig } from '@/config/site';
import { enabledFeatures, isFeatureEnabled } from '@/config/features';

describe('middleware + config safety', () => {
  it('normalizes trailing slashes consistently (root untouched)', () => {
    expect(normalizePathname('/news/')).toBe('/news');
    expect(normalizePathname('/news')).toBeNull();
    expect(normalizePathname('/')).toBeNull();
  });

  it('exposes no server-only secrets to the client bundle', () => {
    const serialized = JSON.stringify(siteConfig);
    for (const needle of ['secret', 'SERVICE_ROLE', 'service_role', 'BEGIN PRIVATE', 'password', 'token']) {
      expect(serialized.toLowerCase()).not.toContain(needle.toLowerCase());
    }
    expect(siteConfig.apiUrl).toBeTruthy();
  });

  it('gates phased features without breaking the build', () => {
    expect(typeof isFeatureEnabled('search')).toBe('boolean');
    expect(Array.isArray(enabledFeatures())).toBe(true);
  });
});
