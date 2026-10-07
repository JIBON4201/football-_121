import { PageHeader } from './ui/PageHeader';

interface AdminSectionProps {
  title: string;
  description: string;
}

/**
 * Shared frame for Admin sections: one `h1` per page plus a short description.
 * Section data, tables and forms are deliberately left to later steps — this
 * is the route and layout foundation only.
 */
export function AdminSection({ title, description }: AdminSectionProps) {
  return <PageHeader title={title} description={description} />;
}
