import type { Metadata } from 'next';
import { SiteHeader } from '@/components/touchline/site-header';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { SiteFooter } from '@/components/touchline/site-footer';

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: true },
};

/**
 * Global 404: invalid slugs and unknown routes land here, outside every route
 * group, so no group layout wraps it. It therefore renders the public chrome
 * itself — the same header/footer an unknown public URL has always had — while
 * `/control-center` keeps its own 404 with no public chrome (see
 * `control-center/[...unmatched]/route.ts`).
 */
export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main-content">
        <div className="container">
          <h1>Page not found</h1>
          <p>The page you are looking for does not exist or has moved.</p>
          <a href="/">Back to home</a>
        </div>
      </main>
      <SiteFooter />
      <MobileBottomNav />
    </>
  );
}