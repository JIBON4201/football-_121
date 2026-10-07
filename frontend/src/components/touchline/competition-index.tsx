"use client";

import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { COMPETITION_GROUPS, type CompetitionDirectory, type CompetitionEntry } from "@/lib/touchline/directory-data";
import { DirectoryEmpty, IndexGroup } from "./index-shell";
import { Icon } from "./icons";

function CompetitionMark({ entry, size = "md" }: { entry: CompetitionEntry; size?: "sm" | "md" }) {
  return (
    <span className={`cp-mark cp-mark--${size}`} style={{ "--cp-accent": entry.accent ?? "#3d5142" } as CSSProperties}>
      {entry.logoUrl ? <img src={entry.logoUrl} alt="" loading="lazy" decoding="async" /> : <span>{entry.abbreviation.slice(0, 3)}</span>}
    </span>
  );
}

function CompetitionRow({ entry }: { entry: CompetitionEntry }) {
  return (
    <li className="cp-row">
      <a className="cp-row__link" href={entry.href}>
        <CompetitionMark entry={entry} />
        <span className="cp-row__identity">
          <span className="cp-row__name">{entry.name}</span>
          <span className="cp-row__region">{entry.region ?? "Unassigned region"}</span>
        </span>
        <span className="cp-row__type">{entry.type ?? ""}</span>
        <span className="cp-row__coverage">
          {entry.coverage.live > 0 ? <><strong>{entry.coverage.live} live</strong></> : entry.coverage.fixtures > 0 ? <><strong>{entry.coverage.fixtures}</strong><span> fixtures</span></> : null}
        </span>
        <span className="cp-row__go" aria-hidden="true"><Icon name="arrow-up-right" size={17} /></span>
      </a>
    </li>
  );
}

function GroupList({ entries }: { entries: CompetitionEntry[] }) {
  return (
    <ul className="cp-rows">
      {entries.map((entry) => (
        <CompetitionRow entry={entry} key={entry.id} />
      ))}
    </ul>
  );
}

export function CompetitionIndex({ directory }: { directory: CompetitionDirectory }) {
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("All");

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return directory.entries.filter((entry) => {
      const haystack = `${entry.name} ${entry.region ?? ""} ${entry.abbreviation} ${entry.type ?? ""}`.toLowerCase();
      const matchesQuery = !needle || haystack.includes(needle);
      const matchesRegion = region === "All" || entry.region === region;
      return matchesQuery && matchesRegion;
    });
  }, [directory.entries, query, region]);

  const byGroup = useMemo(() => {
    const map = new Map<string, CompetitionEntry[]>();
    for (const entry of filtered) {
      const bucket = map.get(entry.group) ?? [];
      bucket.push(entry);
      map.set(entry.group, bucket);
    }
    return map;
  }, [filtered]);

  const regions = useMemo(() => [...new Set(directory.entries.map((e) => e.region).filter((region): region is string => typeof region === "string" && region.length > 0))].sort(), [directory.entries]);
  const showRegions = regions.length > 1;

  if (directory.entries.length === 0) {
    return <DirectoryEmpty title="No competitions" description="Check back soon." />;
  }

  return (
    <>
      <div className="cp-controls">
        <label className="cp-search">
          <Icon name="search" size={18} />
          <span className="sr-only">Search competitions</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Search competitions…" />
        </label>
        {showRegions && (
          <div className="cp-region-rail" role="group" aria-label="Filter by region">
            <div className="cp-region-rail__options">
              <button type="button" className={`cp-pill${region === "All" ? " is-active" : ""}`} aria-pressed={region === "All"} onClick={() => setRegion("All")}>All</button>
              {regions.map((name) => (
                <button key={name} type="button" className={`cp-pill${region === name ? " is-active" : ""}`} aria-pressed={region === name} onClick={() => setRegion(name)}>{name}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <DirectoryEmpty title="No competitions found" description="Try a different name or region." />
      ) : (
        <div className="cp-sections">
          {COMPETITION_GROUPS.map((meta) => {
            const entries = byGroup.get(meta.id) ?? [];
            if (!entries.length) return null;
            return (
              <IndexGroup id={meta.id} key={meta.id} title={meta.title} count={entries.length} countLabel={`${entries.length}`}>
                <GroupList entries={entries} />
              </IndexGroup>
            );
          })}
          {(() => {
            const others = byGroup.get("other") ?? [];
            if (!others.length) return null;
            return (
              <IndexGroup id="other" title="More competitions" count={others.length} countLabel={`${others.length}`}>
                <GroupList entries={others} />
              </IndexGroup>
            );
          })()}
        </div>
      )}
    </>
  );
}
