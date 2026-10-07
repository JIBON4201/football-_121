import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { breakpoints, containers, radii, spacing, typography } from '@/styles/tokens';

describe('design system + responsive foundation', () => {
  it('centralizes tokens (single redesign point)', () => {
    expect(breakpoints).toMatchObject({ mobile: 0, tablet: 640, desktop: 1024, wide: 1280 });
    expect(containers.xl).toBe('1280px');
    expect(Object.keys(typography.scale).length).toBeGreaterThan(5);
    expect(Object.keys(spacing).length).toBeGreaterThan(4);
    expect(radii.full).toBe('9999px');
  });

  it('ships mobile-first CSS with focus, motion and breakpoint support', () => {
    const css = readFileSync(join(__dirname, '..', 'src', 'styles', 'globals.css'), 'utf8');
    expect(css).toContain('@media (min-width: 640px)');
    expect(css).toContain('@media (min-width: 1024px)');
    expect(css).toContain('@media (min-width: 1280px)');
    expect(css).toContain(':focus-visible');
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain('.visually-hidden');
    expect(css).toContain('.grid-cards');
  });
});
