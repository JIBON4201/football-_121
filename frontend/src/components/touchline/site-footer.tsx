import { siteConfig } from "@/config/site";
import { Icon } from "./icons";

const footerGroups = [
  { title: "Match centre", links: [{ label: "Live scores", href: "/live" }, { label: "Fixtures & results", href: "/matches" }, { label: "Transfer centre", href: "/transfers" }] },
  { title: "Newsroom", links: [{ label: "Latest news", href: "/news" }, { label: "Breaking news", href: "/breaking-news" }, { label: "Search", href: "/search" }] },
  { title: "Directory", links: [{ label: "Competitions", href: "/competitions" }, { label: "Teams", href: "/teams" }, { label: "Players", href: "/players" }] },
];

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="page-container">
        <div className="site-footer__main">
          <div className="site-footer__brand-column">
            <a className="brand brand--footer" href="/" aria-label={`${siteConfig.name} home`}><span className="brand__mark" aria-hidden="true"><span /><span /><span /></span><span className="brand__word">{siteConfig.name.toLowerCase()}<span>.</span></span></a>
            <p>Independent football coverage — live scores, fixtures, transfers and reporting from every corner of the game.</p>
            <div className="site-footer__socials" aria-label="Social media">
              <a href="https://www.instagram.com/" aria-label="Instagram"><Icon name="instagram" size={18} /></a>
              <a href="https://x.com/" aria-label="X"><Icon name="x" size={16} /></a>
            </div>
          </div>
          {footerGroups.map((group) => (
            <nav className="site-footer__group" key={group.title} aria-label={group.title}>
              <h2>{group.title}</h2>
              <ul>{group.links.map((link) => <li key={link.label}><a href={link.href}>{link.label}</a></li>)}</ul>
            </nav>
          ))}
        </div>
        <div className="site-footer__bottom"><span>© {new Date().getFullYear()} {siteConfig.name}. All rights reserved.</span><span className="site-footer__motto"><Icon name="ball" size={14} /> Independent perspective. Global game.</span></div>
      </div>
    </footer>
  );
}
