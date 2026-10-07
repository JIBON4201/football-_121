import { PageLayout } from "@/components/touchline/page-components";

/** Route-level skeleton shaped like the competition directory: controls plus indexed section rows. */
export default function Loading() {
  return (
    <PageLayout>
      <div className="page-container page-container--content hub-skeleton hub-skeleton--directory" role="status" aria-live="polite" aria-busy="true">
        <span className="sr-only">Loading the competition directory</span>
        <div className="hub-skeleton__crumbs"><i /><i /></div>
        <div className="hub-skeleton__hero"><i /><b /><span /></div>
        <div className="hub-skeleton__controls"><i /><i /><i /><i /></div>
        {Array.from({ length: 3 }, (_, group) => (
          <div className="hub-skeleton__group" key={group}>
            <div className="hub-skeleton__group-heading"><i /><b /></div>
            {Array.from({ length: group === 0 ? 3 : 3 }, (_, row) => (
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