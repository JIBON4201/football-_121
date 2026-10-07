import type { SVGProps } from 'react';

/**
 * Inline icon set for the Control Center.
 *
 * Hand-rolled rather than pulled from a package: the panel needs ~16 glyphs and
 * the project already commits to a zero-extra-dependency bundle budget. Every
 * icon is a 24x24 stroked path on a shared base so they optically align, and
 * each is `aria-hidden` because icons here are always decorative beside a text
 * label — never the only carrier of meaning.
 */

export type AdminIconName =
  | 'dashboard'
  | 'news'
  | 'transfers'
  | 'matches'
  | 'teams'
  | 'players'
  | 'competitions'
  | 'media'
  | 'settings'
  | 'users'
  | 'roles'
  | 'audit'
  | 'search'
  | 'refresh'
  | 'plus'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'menu'
  | 'close'
  | 'alert'
  | 'info'
  | 'check'
  | 'trash'
  | 'edit'
  | 'external'
  | 'inbox'
  | 'logout'
  | 'panel';

const PATHS: Record<AdminIconName, string> = {
  dashboard: 'M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6V11h-6v9Zm0-16v5h6V4h-6Z',
  news: 'M4 5h13v14H5a1 1 0 0 1-1-1V5Zm13 3h3v9a2 2 0 0 1-2 2h-1V8ZM7 8h7M7 11h7M7 14h4',
  transfers: 'M4 8h13m0 0-3-3m3 3-3 3M20 16H7m0 0 3 3m-3-3 3-3',
  matches: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c2.5 2.2 3.8 5.4 3.8 9S14.5 18.8 12 21m0-18C9.5 5.2 8.2 8.4 8.2 12s1.3 6.8 3.8 9M3.6 9h16.8M3.6 15h16.8',
  teams: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
  players: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 3c-3 0-5.6 1.3-7 3.5M12 15c3 0 5.6 1.3 7 3.5',
  competitions: 'M8 4h8v4a4 4 0 0 1-8 0V4Zm-3 9h5l1 7H6l-1-7Zm11 0h-5l-1 7h5l1-7Z',
  media: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Zm0 9 4-4 3 3 3-3 6 6M9 8.5h.01',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 3h-4l-.4 2.6c-.7.3-1.4.7-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1c.6.5 1.3.9 2 1.2l.4 2.6h4l.4-2.6c.7-.3 1.4-.7 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
  users: 'M9 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 8a6 6 0 0 1 12 0m1-13.5a3.5 3.5 0 0 1 0 6.8m.5 1.4a6 6 0 0 1 4.5 5.3',
  roles: 'M12 3 4 6.5v5c0 4.5 3.2 8.4 8 9.5 4.8-1.1 8-5 8-9.5v-5L12 3Zm-2.5 9 1.8 1.8 3.4-3.6',
  audit: 'M8 3h8l1 3h3v15H4V6h3l1-3Zm1 8h6m-6 4h6M12 3v3',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 5 5',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  plus: 'M12 5v14m-7-7h14',
  'chevron-left': 'M14.5 6 9 12l5.5 6',
  'chevron-right': 'M9.5 6 15 12l-5.5 6',
  'chevron-down': 'M6 9.5 12 15l6-5.5',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6 6 18',
  alert: 'M12 8v5m0 3.5h.01M10.3 3.9 2.5 17.4A2 2 0 0 0 4.2 20.4h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-9v4.5M12 7.8h.01',
  check: 'M4.5 12.5 9.5 17.5 19.5 6.5',
  trash: 'M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7h12ZM10 11v6m4-6v6',
  edit: 'M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3ZM14.5 6.5l3 3',
  external: 'M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  inbox: 'M4 13h4l1 3h6l1-3h4M4 13 6.5 5h11L20 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5Z',
  logout: 'M15 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-2M10 12h11m0 0-3.5-3.5M21 12l-3.5 3.5',
  panel: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm10 0v14',
};

export interface AdminIconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: AdminIconName;
  size?: number;
}

/** Single decorative glyph. Always paired with a text label in this panel. */
export function AdminIcon({ name, size = 16, ...rest }: AdminIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}