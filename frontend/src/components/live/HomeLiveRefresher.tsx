'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { isLiveStatus, pollIntervalFor } from '@/lib/live-state';

/**
 * Keeps the homepage live section current.
 *
 * The section itself stays a server component, so the first paint is still a
 * plain, crawlable render. This renders nothing: it only revalidates the route
 * on an adaptive interval while something is actually in play, so scores on the
 * homepage move without a reload.
 *
 * It renders `null`, pauses while the tab is hidden, and does nothing at all
 * when no match is in progress.
 */
export function HomeLiveRefresher({ statuses }: { statuses: string[] }) {
  let router: ReturnType<typeof useRouter> | null = null;
  try {
    // The router context is absent in isolation (unit tests); absence simply
    // disables revalidation. The hook call itself is unconditional, so hook
    // order is stable.
    router = useRouter();
  } catch {
    router = null;
  }

  const key = statuses.join(',');

  useEffect(() => {
    if (router === null) return;
    const list = key.length > 0 ? key.split(',') : [];
    if (!list.some((status) => isLiveStatus(status))) return;
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      router.refresh();
    }, pollIntervalFor(list));
    return () => clearInterval(id);
  }, [key, router]);

  return null;
}
