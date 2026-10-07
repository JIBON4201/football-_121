-- ============================================================================
-- 011_seo_metadata.sql
-- Production SEO Metadata System
-- ============================================================================

-- ============================================================================
-- 1. SEO_METADATA TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.seo_metadata (
    id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type       varchar(50)  NOT NULL,
    entity_id         uuid         NOT NULL,
    meta_title        varchar(70),
    meta_description  varchar(160),
    canonical_url     text,
    robots_index      boolean      NOT NULL DEFAULT true,
    robots_follow     boolean      NOT NULL DEFAULT true,
    og_title          varchar(200),
    og_description    text,
    og_image          text,
    twitter_title     varchar(200),
    twitter_description text,
    twitter_image     text,
    schema_type       varchar(100),
    created_at        timestamptz  NOT NULL DEFAULT now(),
    updated_at        timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uq_seo_entity           UNIQUE (entity_type, entity_id),
    CONSTRAINT chk_seo_entity_type_not_empty CHECK (length(btrim(entity_type)) > 0),
    CONSTRAINT chk_seo_meta_title_length     CHECK (meta_title IS NULL OR length(meta_title) <= 70),
    CONSTRAINT chk_seo_meta_desc_length      CHECK (meta_description IS NULL OR length(meta_description) <= 160),
    CONSTRAINT chk_seo_og_title_length       CHECK (og_title IS NULL OR length(og_title) <= 200),
    CONSTRAINT chk_seo_twitter_title_length  CHECK (twitter_title IS NULL OR length(twitter_title) <= 200)
);

-- ============================================================================
-- 2. INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_seo_entity_type ON public.seo_metadata (entity_type);
CREATE INDEX IF NOT EXISTS idx_seo_entity_id   ON public.seo_metadata (entity_id);

-- ============================================================================
-- 3. UPDATED_AT TRIGGER
-- ============================================================================

DROP TRIGGER IF EXISTS trg_seo_metadata_updated_at ON public.seo_metadata;
CREATE TRIGGER trg_seo_metadata_updated_at
    BEFORE UPDATE ON public.seo_metadata
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 4. RLS
-- ============================================================================

ALTER TABLE public.seo_metadata ENABLE ROW LEVEL SECURITY;

-- Public read: SEO metadata for published articles
CREATE POLICY seo_metadata_select_published ON public.seo_metadata
    FOR SELECT
    TO anon, authenticated
    USING (
        (entity_type = 'article' AND EXISTS (
            SELECT 1 FROM public.articles a
            WHERE a.id = entity_id
              AND a.status = 'published'
              AND a.published_at IS NOT NULL
        ))
        OR entity_type IN ('match', 'team', 'player', 'competition', 'category', 'tag')
    );

-- Authors: manage SEO for own draft/review articles
CREATE POLICY seo_metadata_insert_own ON public.seo_metadata
    FOR INSERT
    TO authenticated
    WITH CHECK (
        entity_type = 'article'
        AND EXISTS (
            SELECT 1 FROM public.articles a
            WHERE a.id = entity_id
              AND a.author_id = auth.uid()
              AND a.status IN ('draft', 'review')
        )
    );

CREATE POLICY seo_metadata_update_own ON public.seo_metadata
    FOR UPDATE
    TO authenticated
    USING (
        entity_type = 'article'
        AND EXISTS (
            SELECT 1 FROM public.articles a
            WHERE a.id = entity_id
              AND a.author_id = auth.uid()
              AND a.status IN ('draft', 'review')
        )
    )
    WITH CHECK (
        entity_type = 'article'
        AND EXISTS (
            SELECT 1 FROM public.articles a
            WHERE a.id = entity_id
              AND a.author_id = auth.uid()
              AND a.status IN ('draft', 'review')
        )
    );

CREATE POLICY seo_metadata_delete_own ON public.seo_metadata
    FOR DELETE
    TO authenticated
    USING (
        entity_type = 'article'
        AND EXISTS (
            SELECT 1 FROM public.articles a
            WHERE a.id = entity_id
              AND a.author_id = auth.uid()
              AND a.status IN ('draft', 'review')
        )
    );
