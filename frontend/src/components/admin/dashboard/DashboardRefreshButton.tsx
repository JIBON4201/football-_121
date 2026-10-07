'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

/**
 * Re-runs the current server render — i.e. re-fetches the dashboard through
 * the existing server-side data layer. No client cache, no duplicate fetch.
 */
export function DashboardRefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="cc-button cc-button--ghost"
      disabled={pending}
      aria-busy={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      {pending ? 'Refreshing…' : 'Refresh'}
    </button>
  );
}