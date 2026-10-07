import { ArticleCard } from '@/components/news/ArticleCard';
import { Pagination } from '@/components/news/Pagination';
import type { Article, PaginationMeta } from '@/types/api';

interface ArticleListProps {
  articles: Article[];
  pagination: PaginationMeta;
  baseHref: string;
  extraQuery?: Record<string, string>;
  listLabel: string;
}

/** Article listing + server-rendered pagination (stable backend ordering). */
export function ArticleList({ articles, pagination, baseHref, extraQuery = {}, listLabel }: ArticleListProps) {
  return (
    <div>
      <ul className="grid-cards" aria-label={listLabel}>
        {articles.map((article) => (
          <li key={article.id}>
            <ArticleCard article={article} href={`/news/${article.slug}`} />
          </li>
        ))}
      </ul>
      <Pagination page={pagination.page} totalPages={pagination.totalPages} baseHref={baseHref} extraQuery={extraQuery} />
    </div>
  );
}
