import type { BreadcrumbItem } from '@/types/api';
import { sanitizeText } from '@/lib/validation';

/** Centralized breadcrumb trail (canonical URLs from the SEO API). */
export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb">
      <ol>
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.url}-${index}`}>
              {last ? (
                <span aria-current="page">{sanitizeText(item.name)}</span>
              ) : (
                <a href={item.url}>{sanitizeText(item.name)}</a>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
