import { PageLayout } from "@/components/touchline/page-components";

/** Route-level skeleton shaped like the transfer tracker: controls, movement rows and a rail. */
export default function Loading() {
  return (
    <PageLayout>
      <div className="page-container page-container--content hub-skeleton hub-skeleton--transfers" role="status" aria-live="polite" aria-busy="true">
        <span className="sr-only">Loading the transfer centre</span>
        <div className="hub-skeleton__crumbs"><i /><i /></div>
        <div className="hub-skeleton__hero"><i /><b /><span /></div>
        <div className="hub-skeleton__controls"><i /><i /><i /></div>
        <div className="hub-skeleton__split">
          <div className="hub-skeleton__rows">
            {Array.from({ length: 6 }, (_, index) => (
              <div className="hub-skeleton__row" key={index}>
                <span className="hub-skeleton__avatar" />
                <div className="hub-skeleton__route"><i /><b /><i /></div>
                <span className="hub-skeleton__chip" />
              </div>
            ))}
          </div>
          <div className="hub-skeleton__rail">
            {Array.from({ length: 4 }, (_, index) => (
              <div className="hub-skeleton__rail-row" key={index}><i /><span /></div>
            ))}
          </div>
        </div>
      </div>
    </PageLayout>
  );
}