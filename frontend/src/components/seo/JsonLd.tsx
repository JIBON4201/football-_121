interface JsonLdProps {
  data: unknown;
}

/** Safely serialized JSON-LD (single injection point, escaped output). */
export function JsonLd({ data }: JsonLdProps) {
  const json = JSON.stringify(data).replace(/<\//g, '<\\/');
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
