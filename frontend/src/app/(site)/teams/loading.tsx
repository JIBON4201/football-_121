import { PageLayout } from "@/components/touchline/page-components";

/** Route-level skeleton shaped like the club directory: controls, featured band, country groups. */
export default function Loading() {
  return (
    <PageLayout>
      <div className="page-container page-container--content hub-skeleton hub-skeleton--directory" role="status" aria-live="polite" aria-busy="true">
        <span className="sr-only">Loading the club directory</span>
        <div className="hub-skeleton__crumbs"><i /><i /></div>
        <div className="hub-skeleton__hero"><i /><b /><span /></div>
        <div className="hub-skeleton__controls"><i /><i /><i /><i /></div>
        <div className="hub-skeleton__featured">
          {Array.from({ length: 4 }, (_, index) => (
            <div className="hub-skeleton__featured-item" key={index}><span className="hub-skeleton__mark hub-skeleton__mark--lg" /><i /></div>
          ))}
        </div>
        {Array.from({ length: 2 }, (_, group) => (
          <div className="hub-skeleton__group" key={group}>
            <div className="hub-skeleton__group-heading"><i /><b /></div>
            {Array.from({ length: group + 1 }, (_, row) => (
              <div className="hub-skeleton__line" key={row}>
                <span className="hub-skeleton__mark" />
                <div><i /><span /></div>
                <span className="hub-skeleton__meta" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </PageLayout>
  );
}