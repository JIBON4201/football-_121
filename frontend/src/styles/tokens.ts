/**
 * Centralized visual tokens, mirroring the custom properties in `globals.css`.
 * A full redesign means editing this file (and the `:root` block in globals.css)
 * — never individual components.
 */

export const breakpoints = {
  mobile: 0,
  tablet: 640,
  desktop: 1024,
  wide: 1280,
} as const;

export type BreakpointName = keyof typeof breakpoints;

export const containers = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
} as const;

/**
 * Editorial serif for headlines, humanist sans for utility and body copy.
 * Loaded as webfonts where available; the stacks degrade to the platform faces.
 */
export const fonts = {
  serif: "'Source Serif 4', Georgia, 'Times New Roman', serif",
  sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, ui-sans-serif, system-ui, sans-serif",
  display: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, ui-sans-serif, system-ui, sans-serif",
} as const;

/**
 * Fluid scale. The clamp() ranges keep long headlines readable on narrow screens
 * without needing a separate mobile size for every step.
 */
export const typography = {
  fontFamily: fonts.sans,
  fontFamilySerif: fonts.serif,
  scale: {
    display: 'clamp(2.9rem, 5.2vw, 4.4rem)',
    h1: 'clamp(2.6rem, 4.8vw, 4.1rem)',
    h2: 'clamp(1.9rem, 3vw, 2.65rem)',
    h3: '1.35rem',
    lead: '1.25rem',
    base: '1.0625rem',
    small: '1rem',
    meta: '0.875rem',
  },
  lineHeight: { tight: 1.15, base: 1.6, relaxed: 1.75 },
  weight: { regular: 400, medium: 500, semibold: 600, bold: 700, heavy: 800 },
} as const;

export const spacing = {
  xs: '0.25rem',
  sm: '0.5rem',
  md: '1rem',
  lg: '1.5rem',
  xl: '2rem',
  '2xl': '3rem',
} as const;

export const radii = {
  xs: '2px',
  sm: '4px',
  md: '6px',
  lg: '10px',
  full: '9999px',
} as const;

/** Shared interactive control height, so filters and inputs stay aligned. */
export const controlHeight = '46px';

export const palette = {
  ink: '#121a14',
  ink2: '#223026',
  muted: '#54605a',
  faint: '#75817a',
  paper: '#f6f7f4',
  surface: '#ffffff',
  wash: '#ecefe9',
  wash2: '#e4e9e1',
  line: '#dde3da',
  lineStrong: '#c3cec0',
  pine: '#0d1f14',
  pine2: '#162e1f',
  pine3: '#1e3a28',
  lime: '#cdf14d',
  limeDeep: '#a8c72e',
} as const;

/** Match-state colours. Live is reserved for in-play only. */
export const states = {
  live: '#d92d20',
  liveBackground: '#fdf0ee',
  breaking: '#b42318',
  success: '#a8c72e',
  warning: '#b54708',
  error: '#b42318',
  info: '#175cd3',
} as const;

/**
 * Named surface roles so components never pick a raw hex. Mirrored as CSS custom
 * properties in globals.css; keep the two in step.
 */
export const surfaces = {
  page: 'var(--color-paper)',
  raised: 'var(--color-surface)',
  sunken: 'var(--color-wash)',
  inverse: 'var(--color-pine)',
  inverseText: '#ffffff',
} as const;

export const motion = {
  ease: 'cubic-bezier(.2,.65,.3,1)',
  duration: '160ms',
} as const;