import type { ReactNode } from 'react';

interface BadgeProps {
  tone?: 'neutral' | 'live' | 'info' | 'warning';
  children: ReactNode;
}

/** Small status/label badge (live regions are the caller's responsibility). */
export function Badge({ tone = 'neutral', children }: BadgeProps) {
  return (
    <span className="badge" data-tone={tone}>
      {children}
    </span>
  );
}
