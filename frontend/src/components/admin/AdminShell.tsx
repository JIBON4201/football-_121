'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ADMIN_NAV_ITEMS, filterNavItems, groupNavItems, navLabelForPath } from '@/lib/admin-navigation';
import { AdminNavLinks } from './AdminNavLinks';
import { AdminIcon } from './ui/AdminIcon';
import { AdminButton } from './ui/AdminButton';
import { logoutAction } from '@/app/control-center/login/actions';

export interface AdminShellProps {
  children: React.ReactNode;
  email: string | null;
  roles: string[];
  permissions: string[];
}

const NAV_COLLAPSE_KEY = 'cc.nav.collapsed';

/** First letter of the account email, for the avatar chip. */
function initials(email: string | null): string {
  if (!email) return '?';
  const trimmed = email.trim();
  return trimmed.charAt(0) || '?';
}

/**
 * Admin chrome: topbar + grouped sidebar + main column.
 *
 * Rendered only after the backend has confirmed an active Admin session, so the
 * nav items are a convenience — every action re-checks permissions server-side.
 *
 * Two independent disclosure states, because they behave differently:
 *   - `collapsed`  desktop only, icons-only rail, persisted to localStorage
 *   - `drawerOpen` mobile only, overlay drawer closed on every navigation
 */
export function AdminShell({ children, email, roles, permissions }: AdminShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [context, setContext] = useState<string | null>(null);

  const pathname = usePathname() ?? '';
  const items = filterNavItems(ADMIN_NAV_ITEMS, permissions);
  const groups = groupNavItems(items);

  // Restore the rail preference after mount so server and client markup match.
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(NAV_COLLAPSE_KEY) === 'true');
    } catch {
      /* storage unavailable — keep the expanded default */
    }
  }, []);

  useEffect(() => {
    setDrawerOpen(false);
    setContext(navLabelForPath(pathname));
  }, [pathname]);

  // Lock body scroll while the mobile drawer is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  // Escape closes the drawer.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const toggleCollapsed = () => {
    setCollapsed((previous) => {
      const next = !previous;
      try {
        window.localStorage.setItem(NAV_COLLAPSE_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return (
    <div
      className="cc-shell"
      data-drawer-open={drawerOpen ? 'true' : undefined}
      data-nav-collapsed={collapsed ? 'true' : undefined}
    >
      <a className="cc-skip" href="#cc-main">
        Skip to content
      </a>

      <header className="cc-topbar">
        <div className="cc-topbar__left">
          <AdminButton
            className="cc-topbar__toggle"
            variant="ghost"
            size="sm"
            iconOnly
            icon="menu"
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            aria-controls="cc-sidebar"
            onClick={() => setDrawerOpen(true)}
          />
          <AdminButton
            className="cc-topbar__collapse"
            variant="ghost"
            size="sm"
            iconOnly
            icon="panel"
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            aria-pressed={collapsed}
            onClick={toggleCollapsed}
          />
          <span className="cc-brand">
            <span className="cc-brand__mark" aria-hidden="true">
              <AdminIcon name="matches" size={15} />
            </span>
            <span className="cc-brand__text">Control Center</span>
          </span>
          {context ? (
            <>
              <span className="cc-topbar__divider" aria-hidden="true" />
              <span className="cc-topbar__context">{context}</span>
            </>
          ) : null}
        </div>

        <div className="cc-topbar__right">
          <form action={logoutAction}>
            <AdminButton type="submit" variant="ghost" size="sm" icon="logout">
              Sign out
            </AdminButton>
          </form>
        </div>
      </header>

      <div className="cc-body">
        {drawerOpen ? (
          <button
            type="button"
            className="cc-scrim"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
          />
        ) : null}

        <nav id="cc-sidebar" className="cc-sidebar" aria-label="Admin sections">
          <AdminButton
            className="cc-sidebar__close"
            variant="ghost"
            size="sm"
            iconOnly
            icon="close"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
          />

          {groups.map((group) => (
            <div className="cc-nav__group" key={group.group}>
              <p className="cc-nav__group-label">{group.label}</p>
              <AdminNavLinks
                items={group.items}
                pathname={pathname}
                collapsed={collapsed}
                onNavigate={() => setDrawerOpen(false)}
              />
            </div>
          ))}

          <div className="cc-nav__footer">
            <div className="cc-user">
              <span className="cc-user__avatar" aria-hidden="true">
                {initials(email)}
              </span>
              <span className="cc-user__body">
                <span className="cc-user__email">{email ?? 'Signed in'}</span>
                {roles.length > 0 ? <span className="cc-user__roles">{roles.join(', ')}</span> : null}
              </span>
            </div>
          </div>
        </nav>

        <main id="cc-main" className="cc-main" tabIndex={-1}>
          <div className="cc-main__inner">{children}</div>
        </main>
      </div>
    </div>
  );
}