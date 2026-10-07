import { isFeatureEnabled } from '@/config/features';
import { activeNavRoute } from '@/lib/navigation';

interface BottomNavItem {
  route: 'home' | 'live' | 'matches' | 'news' | 'search';
  label: string;
  href: string;
  icon: JSX.Element;
}

function Icon({ d, extra }: { d?: string; extra?: JSX.Element }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true" focusable="false">
      {extra ?? <path d={d} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

const ITEMS: ReadonlyArray<Omit<BottomNavItem, 'icon'> & { icon: 'home' | 'live' | 'matches' | 'news' | 'search' }> = [
  { route: 'home', label: 'Home', href: '/', icon: 'home' },
  { route: 'live', label: 'Live', href: '/live', icon: 'live' },
  { route: 'matches', label: 'Matches', href: '/matches', icon: 'matches' },
  { route: 'news', label: 'News', href: '/news', icon: 'news' },
  { route: 'search', label: 'Search', href: '/search', icon: 'search' },
];

const ICONS: Record<string, JSX.Element> = {
  home: <Icon d="M3 10.5 11 3l8 7.5M5 9.5V19h12V9.5" />,
  live: <Icon extra={<circle cx="11" cy="11" r="6" fill="currentColor" />} />,
  matches: <Icon d="M11 2a9 9 0 100 18 9 9 0 000-18zM11 6v5l3 2" />,
  news: <Icon d="M4 5h14v12H4zM4 9h14M8 5v12" />,
  search: <Icon d="M10 4a6 6 0 104.2 10.3L18 18" />,
};

interface MobileBottomNavProps {
  currentPath?: string;
  /** Hard off-switch; the feature flag is the soft switch. */
  disabled?: boolean;
}

/**
 * Optional mobile bottom quick-nav (Home/Live/Matches/News/Search).
 * Server-rendered, zero JS. Disable via prop or feature flag — no restructuring.
 */
export function MobileBottomNav({ currentPath = '/', disabled = false }: MobileBottomNavProps) {
  if (disabled || !isFeatureEnabled('mobileBottomNav')) return null;
  const active = activeNavRoute(currentPath);
  return (
    <>
      <nav aria-label="Quick" className="mobile-bottom-nav">
        <ul>
          {ITEMS.map((item) => (
            <li key={item.route}>
              <a href={item.href} aria-current={active === item.route ? 'page' : undefined} aria-label={item.label}>
                {ICONS[item.icon]}
                <span>{item.label}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="mobile-bottom-nav__spacer" aria-hidden="true" />
    </>
  );
}
