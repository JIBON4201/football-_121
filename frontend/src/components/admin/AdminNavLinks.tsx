'use client';

import Link from 'next/link';
import type { AdminNavItem } from '@/lib/admin-navigation';
import { AdminIcon } from './ui/AdminIcon';

export interface AdminNavLinksProps {
  items: AdminNavItem[];
  /** Current pathname, injected so the nav stays renderable in isolation. */
  pathname: string;
  onNavigate?: () => void;
  /** Icons-only mode: labels collapse to native tooltips. */
  collapsed?: boolean;
}

/**
 * Sidebar links for the granted permission set, with active-state marking.
 *
 * When collapsed the label is still rendered — visually hidden, and exposed via
 * `title` — so the control keeps an accessible name and a hover tooltip instead
 * of becoming an unlabelled icon.
 */
export function AdminNavLinks({ items, pathname, onNavigate, collapsed = false }: AdminNavLinksProps) {
  return (
    <ul className="cc-nav__list">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <li key={item.key}>
            <Link
              href={item.href}
              className="cc-nav__link"
              aria-current={active ? 'page' : undefined}
              data-active={active ? 'true' : undefined}
              onClick={onNavigate}
              title={collapsed ? item.label : undefined}
            >
              <span className="cc-nav__icon">
                <AdminIcon name={item.icon} size={17} />
              </span>
              <span className="cc-nav__text">{item.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}