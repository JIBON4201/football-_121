import type { ReactNode } from "react";
import { siteConfig } from "@/config/site";
import { Icon } from "./icons";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

/**
 * Page shell for a route body.
 *
 * The site header, the `main#main-content` landmark and the footer are owned
 * exclusively by the root layout (`@/app/layout`). They used to be repeated here
 * as well, which made every `PageLayout` route nest a second header and a second
 * footer inside the layout's own `<main>`, and emit a duplicate `main-content`
 * id — leaving the header's skip link with two possible targets.
 *
 * This is now only the content wrapper that carries the `site-page` shell
 * styling, so every route gets exactly one header and one footer.
 *
 * `isDemo` is accepted and ignored: no demo fixtures are produced, and the prop
 * is kept so existing `PageLayout` call sites keep compiling.
 */
export function PageLayout({ children }: { children: ReactNode; isDemo?: boolean }) {
  return <div className="site-page">{children}</div>;
}

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <ol>
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`}>
            {item.href && index < items.length - 1 ? <a href={item.href}>{item.label}</a> : <span aria-current={index === items.length - 1 ? "page" : undefined}>{item.label}</span>}
            {index < items.length - 1 && <Icon name="chevron-right" size={13} />}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function PageIntro({
  eyebrow,
  title,
  description,
  breadcrumbs,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  breadcrumbs?: BreadcrumbItem[];
  children?: ReactNode;
}) {
  return (
    <header className="page-intro">
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      {description && <p className="page-intro__description">{description}</p>}
      {children}
    </header>
  );
}

export function ContentSection({
  eyebrow,
  title,
  description,
  action,
  children,
  className = "",
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: { label: string; href: string };
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`page-content-section ${className}`.trim()} aria-label={title}>
      <div className="page-content-section__heading">
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action && <a className="text-link" href={action.href}>{action.label}<Icon name="arrow-right" size={16} /></a>}
      </div>
      {children}
    </section>
  );
}


export function StructuredData({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

export function BreadcrumbStructuredData({ items }: { items: BreadcrumbItem[] }) {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? siteConfig.siteUrl;
  return <StructuredData data={{
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.label,
      item: new URL(item.href ?? "/", base).toString(),
    })),
  }} />;
}
