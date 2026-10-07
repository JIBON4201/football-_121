/**
 * Global test setup.
 *
 * `next/cache` is stubbed because its real implementation throws
 * "Invariant: static generation store missing" outside a Next.js request. Admin
 * server actions now call `revalidateTag`/`revalidatePath` after every confirmed
 * write, so every test that exercises an action needs this.
 *
 * The stubs record their calls: `tests/admin-revalidate.test.ts` asserts that a
 * real admin write purges exactly the public cache entries it should. Recording
 * rather than no-op'ing is the point — a silent stub would let invalidation
 * regress unnoticed, which is precisely the bug this work fixed.
 */
import { vi } from 'vitest';

export const revalidateTagCalls: string[] = [];
export const revalidatePathCalls: string[] = [];

vi.mock('next/cache', () => ({
  revalidateTag: (tag: string) => {
    revalidateTagCalls.push(tag);
  },
  revalidatePath: (path: string) => {
    revalidatePathCalls.push(path);
  },
  // Present so importing modules that reference them does not explode.
  unstable_cache: <T>(fn: () => T) => fn,
  unstable_noStore: () => undefined,
}));

export function resetRevalidationCalls(): void {
  revalidateTagCalls.length = 0;
  revalidatePathCalls.length = 0;
}