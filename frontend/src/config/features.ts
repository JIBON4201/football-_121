/** Feature flags for phased rollout. Unknown flags default to false. */

const FLAGS = {
  /** Phase 2: live score polling / streaming surfaces. */
  liveScores: process.env.NEXT_PUBLIC_FEATURE_LIVE === 'true',
  /** Phase 1 content surfaces (enabled by default). */
  breakingNews: process.env.NEXT_PUBLIC_FEATURE_BREAKING !== 'false',
  transfers: process.env.NEXT_PUBLIC_FEATURE_TRANSFERS !== 'false',
  search: process.env.NEXT_PUBLIC_FEATURE_SEARCH !== 'false',
  /** Optional mobile bottom quick-navigation (disable without restructuring). */
  mobileBottomNav: process.env.NEXT_PUBLIC_FEATURE_BOTTOM_NAV !== 'false',
} as const;

export type FeatureFlag = keyof typeof FLAGS;

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return FLAGS[flag] === true;
}

export function enabledFeatures(): FeatureFlag[] {
  return (Object.keys(FLAGS) as FeatureFlag[]).filter((flag) => FLAGS[flag]);
}
