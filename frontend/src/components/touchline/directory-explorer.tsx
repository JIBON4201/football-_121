"use client";

import { useMemo, useState } from "react";
import type { NewsStory, PlayerProfile } from "@/lib/touchline/homepage-types";
import { PlayerCard } from "./discovery-cards";
import { NewsCard } from "./news-card";
import { EmptyState } from "./empty-state";
import { Icon } from "./icons";

function SearchField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="directory-search"><Icon name="search" size={17} /><span className="sr-only">{placeholder}</span><input type="search" value={value} onChange={(event: { currentTarget: { value: string } }) => onChange(event.currentTarget.value)} placeholder={placeholder} /></label>;
}

export function DirectoryExplorer({ items }: { kind: "players"; items: PlayerProfile[] }) {
  const [query, setQuery] = useState("");
  const [facet, setFacet] = useState("All");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const facets = useMemo(() => [...new Set(items.map((item) => item.position).filter(Boolean))].sort(), [items]);
  const showFacets = facets.length > 1;
  const filtered = useMemo(() => items.filter((item) => `${item.name} ${item.teamName ?? ""} ${item.position} ${item.country ?? ""}`.toLocaleLowerCase().includes(normalizedQuery) && (facet === "All" || item.position === facet)), [items, normalizedQuery, facet]);
  return (
    <>
      <div className="directory-controls">
        <div className="directory-toolbar"><SearchField value={query} onChange={setQuery} placeholder="Search players…" /><p aria-live="polite">{filtered.length} {filtered.length === 1 ? "player" : "players"}</p></div>
        {showFacets && (
          <div className="filter-chips" role="group" aria-label="Filter by position">
            {["All", ...facets].map((option) => <button key={option} type="button" className={`filter-chip${facet === option ? " is-active" : ""}`} aria-pressed={facet === option} onClick={() => setFacet(option)}>{option}</button>)}
          </div>
        )}
      </div>
      {filtered.length === 0 ? <EmptyState title="No players found" description="Try a different name or position." /> : (
        <div className="player-grid directory-grid">
          {filtered.map((item) => <PlayerCard player={item} key={item.id} />)}
        </div>
      )}
    </>
  );
}

export function NewsExplorer({ stories, initialCategory = "All" }: { stories: NewsStory[]; initialCategory?: string }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(initialCategory === "Breaking" ? "Breaking" : "All");
  const categories = useMemo(() => ["All", "Breaking", ...Array.from(new Set(stories.map((story) => story.category).filter((item) => item.toLowerCase() !== "breaking")))], [stories]);
  const showCategories = categories.length > 2;
  const filtered = useMemo(() => stories.filter((story) => {
    const matchesCategory = category === "All" || story.category.toLocaleLowerCase() === category.toLocaleLowerCase();
    const matchesQuery = `${story.title} ${story.summary ?? ""} ${story.category}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
    return matchesCategory && matchesQuery;
  }), [stories, category, query]);
  return (
    <>
      <div className="news-filterbar">
        {showCategories && (
          <div className="filter-chips" role="group" aria-label="Filter news by category">{categories.map((item) => <button type="button" className={`filter-chip${category === item ? " is-active" : ""}`} aria-pressed={category === item} onClick={() => setCategory(item)} key={item}>{item}</button>)}</div>
        )}
        <SearchField value={query} onChange={setQuery} placeholder="Search headlines…" />
      </div>
      {filtered.length === 0 ? <EmptyState title="No stories found" description="Try a different search or category." /> : (
        <div className="news-directory-layout">
          <div className="news-directory-layout__lead">
            <NewsCard story={filtered[0]} variant="standard" />
          </div>
          {filtered.length > 1 && (
            <aside className="news-directory-layout__side" aria-label="More top stories">
              <div className="news-directory-layout__side-heading"><h3>More headlines</h3></div>
              {filtered.slice(1, 4).map((story) => <NewsCard key={story.id} story={story} variant="compact" />)}
            </aside>
          )}
          {filtered.length > 4 && (
            <section className="news-directory-layout__feed" aria-label="More football news">
              {filtered.slice(4).map((story) => <NewsCard key={story.id} story={story} variant="standard" />)}
            </section>
          )}
        </div>
      )}
    </>
  );
}
