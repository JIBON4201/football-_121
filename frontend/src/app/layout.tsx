import type { Metadata, Viewport } from 'next';
import { Analytics } from '@vercel/analytics/next';
import { siteConfig } from '@/config/site';
/**
 * Cascade order is deliberate: legacy component styles load first so routes that
 * have not been ported keep rendering, then the pine/lime design system, which wins
 * every class-name collision, then the token aliases for the previous custom
 * property names.
 */
import '@/styles/globals.css';
import '@/styles/touchline.css';
import '@/styles/bridge.css';

/**
 * Bare document shell only — no site chrome here. Public chrome lives in the
 * `(site)` group layout and Admin chrome in `control-center`, so the two
 * surfaces can never leak into each other.
 */

export const metadata: Metadata = {
  title: { default: siteConfig.name, template: `%s | ${siteConfig.name}` },
  description: siteConfig.description,
  metadataBase: new URL(siteConfig.siteUrl),
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0d1f14',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang={siteConfig.locale}>
      <head>
        <meta name="google-site-verification" content="google653d1da704712ed9" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&display=swap"
        />
      </head>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
