-- ============================================================================
-- 007_news_content.sql
-- News & Content core: categories, tags, articles, and relationships
-- ============================================================================

-- ============================================================================
-- 1. CATEGORIES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.categories (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        varchar(100) NOT NULL,
    slug        citext      NOT NULL UNIQUE,
    description text,
    parent_id   uuid        REFERENCES public.categories(id) ON DELETE SET NULL,
    image_url   text,
    is_active   boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 2. TAGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tags (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name       varchar(80) NOT NULL,
    slug       citext      NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 3. ARTICLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.articles (
    id               uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id        uuid              REFERENCES public.profiles(user_id) ON DELETE SET NULL,
    title            varchar(300)      NOT NULL,
    slug             citext            NOT NULL UNIQUE,
    excerpt          text,
    content          text              NOT NULL,
    status           public.article_status NOT NULL DEFAULT 'draft',
    article_type     public.article_type   NOT NULL DEFAULT 'news',
    featured_image_id uuid,
    published_at     timestamptz,
    scheduled_at     timestamptz,
    is_featured      boolean           NOT NULL DEFAULT false,
    is_breaking      boolean           NOT NULL DEFAULT false,
    view_count       bigint            NOT NULL DEFAULT 0,
    created_at       timestamptz       NOT NULL DEFAULT now(),
    updated_at       timestamptz       NOT NULL DEFAULT now(),
    CONSTRAINT chk_articles_view_count CHECK (view_count >= 0)
);

-- ============================================================================
-- 4. ARTICLE_CATEGORIES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.article_categories (
    article_id  uuid        NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
    category_id uuid        NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (article_id, category_id)
);

-- ============================================================================
-- 5. ARTICLE_TAGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.article_tags (
    article_id uuid        NOT NULL REFERENCES public.articles(id) ON DELETE CASCADE,
    tag_id     uuid        NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (article_id, tag_id)
);

-- ============================================================================
-- 6. INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON public.categories (parent_id);
CREATE INDEX IF NOT EXISTS idx_categories_is_active ON public.categories (is_active);

CREATE INDEX IF NOT EXISTS idx_articles_author_id      ON public.articles (author_id);
CREATE INDEX IF NOT EXISTS idx_articles_status_pub    ON public.articles (status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_type_pub      ON public.articles (article_type, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_breaking_pub   ON public.articles (is_breaking, published_at DESC) WHERE is_breaking = true;
CREATE INDEX IF NOT EXISTS idx_articles_featured_pub  ON public.articles (is_featured, published_at DESC) WHERE is_featured = true;

CREATE INDEX IF NOT EXISTS idx_ac_category_id ON public.article_categories (category_id);
CREATE INDEX IF NOT EXISTS idx_at_tag_id      ON public.article_tags (tag_id);

-- ============================================================================
-- 7. UPDATED_AT TRIGGERS
-- ============================================================================

DROP TRIGGER IF EXISTS trg_categories_updated_at ON public.categories;
CREATE TRIGGER trg_categories_updated_at
    BEFORE UPDATE ON public.categories
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_articles_updated_at ON public.articles;
CREATE TRIGGER trg_articles_updated_at
    BEFORE UPDATE ON public.articles
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 8. RLS
-- ============================================================================

ALTER TABLE public.categories        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.articles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_tags      ENABLE ROW LEVEL SECURITY;

-- Categories: public read for active
CREATE POLICY categories_select_active ON public.categories
    FOR SELECT
    TO anon, authenticated
    USING (is_active = true);

-- Tags: public read
CREATE POLICY tags_select_public ON public.tags
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- Articles: public read for published only
CREATE POLICY articles_select_published ON public.articles
    FOR SELECT
    TO anon, authenticated
    USING (status = 'published' AND published_at IS NOT NULL);

-- Articles: authors can create
CREATE POLICY articles_insert_author ON public.articles
    FOR INSERT
    TO authenticated
    WITH CHECK (author_id = auth.uid());

-- Articles: authors can update own draft/review articles
CREATE POLICY articles_update_own ON public.articles
    FOR UPDATE
    TO authenticated
    USING (author_id = auth.uid() AND status IN ('draft', 'review'))
    WITH CHECK (author_id = auth.uid() AND status IN ('draft', 'review'));

-- Article categories: public read for published articles
CREATE POLICY article_categories_select_published ON public.article_categories
    FOR SELECT
    TO anon, authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.articles a
            WHERE a.id = article_id
              AND a.status = 'published'
              AND a.published_at IS NOT NULL
        )
    );

-- Article tags: public read for published articles
CREATE POLICY article_tags_select_published ON public.article_tags
    FOR SELECT
    TO anon, authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.articles a
            WHERE a.id = article_id
              AND a.status = 'published'
              AND a.published_at IS NOT NULL
        )
    );
