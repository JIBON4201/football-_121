import { SiteHeader } from '@/components/touchline/site-header';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { SiteFooter } from '@/components/touchline/site-footer';

/**
 * Public site chrome owner: one header, one `main#main-content` landmark and
 * one footer for every route in the `(site)` group. Pages must never render
 * their own — `PageLayout` is only the content wrapper, precisely so the
 * header, footer and the `main-content` id cannot be duplicated per route.
 * Admin routes (`control-center`) never inherit this layout.
 */
export default function SiteGroupLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <SiteHeader />
      <main id="main-content">{children}</main>
      <SiteFooter />
      <MobileBottomNav />
    </>
  );
}
