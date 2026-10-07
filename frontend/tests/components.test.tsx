import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Alert, EmptyState } from '@/components/ui/Feedback';
import { CardSkeleton, ListSkeleton, MatchSkeleton, PageSkeleton, TableSkeleton } from '@/components/ui/Skeleton';
import { Tabs } from '@/components/ui/Tabs';
import { DataTable } from '@/components/ui/DataTable';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { JsonLd } from '@/components/seo/JsonLd';
import { MatchCard } from '@/components/domain/MatchCard';
import { NewsCard } from '@/components/domain/NewsCard';
import { EntityCard } from '@/components/domain/EntityCard';
import { DateTimeDisplay } from '@/components/domain/DateTimeDisplay';
import { MatchStatus, ScoreDisplay } from '@/components/domain/MatchStatus';
import { TeamBadge } from '@/components/domain/Badges';
import { ResponsiveImage } from '@/components/media/ResponsiveImage';
import { Button } from '@/components/ui/Button';

const match = {
  id: 'm1',
  slug: 'a-vs-b',
  status: 'finished',
  scheduled_at: '2026-08-01T15:00:00.000Z',
  home_score: 2,
  away_score: 1,
  home_team_id: 'h',
  away_team_id: 'a',
  competition_id: 'c',
};

describe('components: semantics, a11y basics, loading and error states', () => {
  it('announces loading and error states to assistive tech', () => {
    for (const node of [
      createElement(PageSkeleton), createElement(ListSkeleton, { count: 2 }),
      createElement(CardSkeleton), createElement(TableSkeleton), createElement(MatchSkeleton),
    ]) {
      const html = renderToString(node);
      expect(html).toContain('role="status"');
      expect(html).toContain('visually-hidden');
    }
    expect(renderToString(createElement(Alert, { tone: 'error', children: 'Down' }))).toContain('role="alert"');
    expect(renderToString(createElement(EmptyState, { title: 'Nothing here' }))).toContain('Nothing here');
    expect(renderToString(createElement(Button, { children: 'Go' }))).toContain('<button');
  });

  it('exposes keyboard-navigable tabs and labelled tables', () => {
    const html = renderToString(
      createElement(Tabs, {
        ariaLabel: 'Sections',
        items: [{ id: 'a', label: 'A', content: 'Alpha' }],
      }),
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tabpanel"');
    const table = renderToString(
      createElement(DataTable<{ n: string }>, {
        caption: 'Standings',
        columns: [{ key: 'n', header: 'Name', render: (row: { n: string }) => row.n }],
        rows: [{ n: 'FC Example' }],
        rowKey: (_row, index) => String(index),
      }),
    );
    expect(table).toContain('<table');
    expect(table).toContain('<caption>Standings</caption>');
    expect(table).toContain('scope="col"');
  });

  it('renders football domain components with accessible names', () => {
    const card = renderToString(createElement(MatchCard, { match, homeName: 'FC Example', awayName: 'Real Sample', href: '/matches/a-vs-b' }));
    expect(card).toContain('<article');
    expect(card).toContain('<time dateTime=');
    const news = renderToString(
      createElement(NewsCard, {
        href: '/news/x',
        article: { id: '1', title: 'Big <b>Win</b>', slug: 'x', excerpt: null, article_type: 'news', published_at: '2026-09-01T10:00:00.000Z', is_featured: false, is_breaking: true, view_count: 0 },
      }),
    );
    expect(news).not.toContain('<b>Win</b>');
    expect(news).toContain('Breaking');
    expect(renderToString(createElement(EntityCard, { title: 'FC Example', href: '/teams/x' }))).toContain('<article');
    expect(renderToString(createElement(DateTimeDisplay, { iso: '2026-08-01T15:00:00.000Z' }))).toContain('<time');
    expect(renderToString(createElement(MatchStatus, { status: 'live' }))).toContain('aria-live="polite"');
    const score = renderToString(
      createElement(ScoreDisplay, { homeScore: 2, awayScore: 1, homeName: 'A', awayName: 'B', status: 'finished' }),
    );
    expect(score).toContain('full time');
    const badge = renderToString(createElement(TeamBadge, { name: 'FC Example', logoUrl: null }));
    expect(badge).toContain('role="img"');
  });

  it('renders responsive images with dimensions and safe JSON-LD', () => {
    const img = renderToString(
      createElement(ResponsiveImage, {
        media: { public_url: 'https://cdn.test/hero.jpg', width: 800, height: 600, alt_text: null, file_name: 'hero.jpg' },
        variants: [],
      }),
    );
    expect(img).toContain('loading="lazy"');
    expect(img).toContain('width="800"');
    expect(img).toContain('alt="hero.jpg"');
    const crumbs = renderToString(createElement(Breadcrumbs, { items: [{ name: 'Home', url: 'https://x/' }] }));
    expect(crumbs).toContain('aria-label="Breadcrumb"');
    const jsonLd = renderToString(createElement(JsonLd, { data: { '@type': 'WebSite', x: '</script>' } }));
    expect(jsonLd).toContain('<\\/script>');
    expect(jsonLd).not.toContain('</script><script');
  });
});
