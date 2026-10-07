-- ============================================================================
-- 021_news_publishing.sql
-- News Management & Publishing Pipeline (Step 26) support
-- No new content models: reuses articles/categories/tags/relations/media/seo.
-- Adds scheduled-publishing index and publish timestamp guardrails.
-- ============================================================================

-- Due scheduled articles lookup: status + scheduled_at (used by publisher).
CREATE INDEX IF NOT EXISTS idx_articles_scheduled_due
    ON public.articles (status, scheduled_at)
    WHERE status = 'scheduled';

-- Published recency lookup for sitemap/news-sitemap eligibility.
CREATE INDEX IF NOT EXISTS idx_articles_published_recent
    ON public.articles (published_at DESC)
    WHERE status = 'published';

-- Guardrail: scheduled articles must carry a scheduled_at timestamp.
-- Enforced as a CHECK so invalid scheduled rows fail fast at the DB layer.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_articles_scheduled_at'
    ) THEN
        ALTER TABLE public.articles
            ADD CONSTRAINT chk_articles_scheduled_at
            CHECK (status <> 'scheduled' OR scheduled_at IS NOT NULL);
    END IF;
END
$$;

-- Guardrail: published articles must carry a published_at timestamp.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_articles_published_at'
    ) THEN
        ALTER TABLE public.articles
            ADD CONSTRAINT chk_articles_published_at
            CHECK (status <> 'published' OR published_at IS NOT NULL);
    END IF;
END
$$;
