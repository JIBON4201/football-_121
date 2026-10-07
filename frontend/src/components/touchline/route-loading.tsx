"use client";

import { usePathname } from "next/navigation";

function LoadingBars({ count = 4 }: { count?: number }) {
  return <div className="route-skeleton__bars">{Array.from({ length: count }, (_, index) => <div className="route-skeleton__row" key={index}><span /><div><i /><i /></div><b /></div>)}</div>;
}

export function RouteLoadingContent() {
  const path = usePathname() ?? "/";
  const isArticle = /^\/news\/[^/]+/.test(path);
  const isEntity = /^\/(competitions|teams|players)\/[^/]+/.test(path);
  const isLiveOrMatches = path === "/live" || path === "/matches";
  const isTransfers = path === "/transfers";

  return (
    <div className="page-container page-container--content route-skeleton" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading {isArticle ? "article" : isEntity ? "profile" : isLiveOrMatches ? "match centre" : isTransfers ? "transfer centre" : "page content"}</span>
      <div className="route-skeleton__intro"><i /><b /><span /></div>
      {isArticle ? (
        <><div className="route-skeleton__media" /><LoadingBars count={3} /></>
      ) : isEntity ? (
        <><div className="route-skeleton__media" style={{ height: 120 }} /><LoadingBars count={5} /></>
      ) : isLiveOrMatches ? (
        <LoadingBars count={6} />
      ) : isTransfers ? (
        <><LoadingBars count={4} /><LoadingBars count={2} /></>
      ) : (
        <><div className="route-skeleton__media" /><LoadingBars count={4} /></>
      )}
    </div>
  );
}
