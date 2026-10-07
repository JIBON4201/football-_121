import { Icon } from "./icons";

interface SectionHeadingProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actionLabel?: string;
  actionHref?: string;
  live?: boolean;
  inverse?: boolean;
  id?: string;
}

export function SectionHeading({ eyebrow, title, description, actionLabel = "View all", actionHref, live, inverse, id }: SectionHeadingProps) {
  return (
    <div className={`section-heading${inverse ? " section-heading--inverse" : ""}`}>
      <div className="section-heading__main">
        {eyebrow && <p className="eyebrow">{live && <span className="live-dot" aria-hidden="true" />}{eyebrow}</p>}
        <h2 id={id}>{title}</h2>
        {description && <p className="section-heading__description">{description}</p>}
      </div>
      {actionHref && <a className="text-link section-heading__action" href={actionHref}>{actionLabel}<Icon name="arrow-right" size={16} /></a>}
    </div>
  );
}
