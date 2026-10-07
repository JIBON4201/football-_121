import { NEWS_FILTERS, type NewsFilterKey } from '@/lib/news';

interface FilterTabsProps {
  active: NewsFilterKey | 'latest';
}

/**
 * News filter navigation as plain links — deterministic filter URLs,
 * crawler-friendly, zero client JavaScript.
 */
export function FilterTabs({ active }: FilterTabsProps) {
  return (
    <nav aria-label="News filters">
      <ul className="filter-tabs">
        {NEWS_FILTERS.map((filter) => (
          <li key={filter.key}>
            <a href={filter.href} aria-current={filter.key === active ? 'page' : undefined}>
              {filter.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
