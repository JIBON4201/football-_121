import type { ReactNode } from 'react';

interface CardProps {
  heading?: string;
  headingLevel?: 2 | 3;
  children: ReactNode;
  footer?: ReactNode;
}

/** Generic surface card (semantic heading when titled). */
export function Card({ heading, headingLevel = 3, children, footer }: CardProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <article className="card">
      {heading ? <Heading className="card__heading">{heading}</Heading> : null}
      <div className="card__body">{children}</div>
      {footer ? <div className="card__footer">{footer}</div> : null}
    </article>
  );
}
