"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { siteConfig } from "@/config/site";
import { Icon } from "./icons";

const navigation = [
  { label: "Live", href: "/live", live: true },
  { label: "Matches", href: "/matches" },
  { label: "News", href: "/news" },
  { label: "Transfers", href: "/transfers" },
  { label: "Competitions", href: "/competitions" },
  { label: "Teams", href: "/teams" },
  { label: "Players", href: "/players" },
];

function NavigationLinks({ mobile = false, onNavigate, currentPath }: { mobile?: boolean; onNavigate?: () => void; currentPath: string }) {
  return (
    <ul className={mobile ? "mobile-nav__list" : "primary-nav__list"}>
      {navigation.map((item) => {
        const active = currentPath === item.href || currentPath.startsWith(`${item.href}/`);
        return (
          <li key={item.label}>
            <a className={`nav-link${item.live ? " nav-link--live" : ""}${active ? " nav-link--active" : ""}`} href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined}>
              {item.live && <span className="live-dot" aria-hidden="true" />}{item.label}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export function SiteHeader() {
  const currentPath = usePathname() ?? "";
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <header className="site-header">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <div className="site-header__inner page-container">
        <a className="brand" href="/" aria-label={`${siteConfig.name} home`}>
          <span className="brand__mark" aria-hidden="true"><span /><span /><span /></span>
          <span className="brand__word">{siteConfig.name.toLowerCase()}<span>.</span></span>
        </a>

        <nav className="primary-nav" aria-label="Primary navigation">
          <NavigationLinks currentPath={currentPath} />
        </nav>

        <div className="site-header__actions">
          <div className="header-search-wrap">
            <button
              className="icon-button"
              type="button"
              aria-label={searchOpen ? "Close search" : "Open search"}
              aria-expanded={searchOpen}
              aria-controls="site-search"
              onClick={() => setSearchOpen((open) => !open)}
            >
              <Icon name={searchOpen ? "close" : "search"} size={20} />
            </button>
            {searchOpen && (
              <form id="site-search" className="header-search" role="search" action="/search" method="get">
                <label className="sr-only" htmlFor="site-search-input">Search football news, teams and players</label>
                <input id="site-search-input" type="search" name="q" placeholder="Search teams, players, news…" autoFocus autoComplete="off" />
                <button type="submit" aria-label="Submit search"><Icon name="arrow-right" size={18} /></button>
              </form>
            )}
          </div>
          <button
            className="icon-button site-header__menu-button"
            type="button"
            aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={menuOpen}
            aria-controls="mobile-navigation"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Icon name={menuOpen ? "close" : "menu"} size={22} />
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav className="mobile-nav" id="mobile-navigation" aria-label="Mobile navigation">
          <div className="page-container">
            <form className="header-search header-search--mobile" role="search" action="/search" method="get" style={{ position: "static", width: "100%", margin: "10px 0" }}>
              <label className="sr-only" htmlFor="mobile-search-input">Search football</label>
              <input id="mobile-search-input" type="search" name="q" placeholder="Search teams, players, news…" autoComplete="off" />
              <button type="submit" aria-label="Submit search"><Icon name="arrow-right" size={18} /></button>
            </form>
            <NavigationLinks mobile currentPath={currentPath} onNavigate={() => setMenuOpen(false)} />
          </div>
        </nav>
      )}
    </header>
  );
}
