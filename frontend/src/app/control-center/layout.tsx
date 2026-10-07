import type { Metadata } from 'next';
import '@/styles/admin.css';

/**
 * Admin Panel document owner. No `SiteHeader`, `MobileBottomNav` or
 * `SiteFooter` is mounted here or below: the public chrome lives exclusively
 * in the `(site)` group layout, so neither surface can leak into the other.
 * Every Admin route is additionally noindex/noarchive and disallowed in
 * robots.txt — the hidden URL is never the security boundary, only the
 * backend Admin API is.
 */
export const metadata: Metadata = {
  title: 'Control Center',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function ControlCenterLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="cc-root">{children}</div>;
}