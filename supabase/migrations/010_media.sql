-- ============================================================================
-- 010_media.sql
-- Production Media System: media metadata table and article FK
-- ============================================================================

-- ============================================================================
-- 1. MEDIA TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.media (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    storage_path text        NOT NULL,
    public_url   text,
    file_name    varchar(255) NOT NULL,
    mime_type    varchar(100) NOT NULL,
    width        integer,
    height       integer,
    file_size    bigint,
    alt_text     varchar(500),
    caption      text,
    credit       varchar(255),
    uploaded_by  uuid        REFERENCES public.profiles(user_id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_media_storage_path     UNIQUE (storage_path),
    CONSTRAINT chk_media_file_name_empty  CHECK (length(btrim(file_name)) > 0),
    CONSTRAINT chk_media_storage_path_empty CHECK (length(btrim(storage_path)) > 0),
    CONSTRAINT chk_media_mime_type_empty  CHECK (length(btrim(mime_type)) > 0),
    CONSTRAINT chk_media_width           CHECK (width IS NULL OR width >= 0),
    CONSTRAINT chk_media_height          CHECK (height IS NULL OR height >= 0),
    CONSTRAINT chk_media_file_size       CHECK (file_size IS NULL OR file_size >= 0),
    CONSTRAINT chk_media_alt_text_length CHECK (alt_text IS NULL OR length(alt_text) <= 500)
);

-- ============================================================================
-- 2. ARTICLE FEATURED IMAGE FK
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_articles_featured_image'
          AND conrelid = 'public.articles'::regclass
    ) THEN
        ALTER TABLE public.articles
            ADD CONSTRAINT fk_articles_featured_image
            FOREIGN KEY (featured_image_id)
            REFERENCES public.media(id)
            ON DELETE SET NULL;
    END IF;
END
$$;

-- ============================================================================
-- 3. INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_media_uploaded_by ON public.media (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_media_mime_type   ON public.media (mime_type);
CREATE INDEX IF NOT EXISTS idx_media_created_at  ON public.media (created_at);

-- ============================================================================
-- 4. UPDATED_AT TRIGGER
-- ============================================================================

DROP TRIGGER IF EXISTS trg_media_updated_at ON public.media;
CREATE TRIGGER trg_media_updated_at
    BEFORE UPDATE ON public.media
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 5. RLS
-- ============================================================================

ALTER TABLE public.media ENABLE ROW LEVEL SECURITY;

-- Public read: media referenced by published articles or uploaded by active users
CREATE POLICY media_select_public ON public.media
    FOR SELECT
    TO anon, authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.articles a
            WHERE a.featured_image_id = media.id
              AND a.status = 'published'
              AND a.published_at IS NOT NULL
        )
        OR uploaded_by IS NOT NULL
    );

-- Authors: insert own media
CREATE POLICY media_insert_own ON public.media
    FOR INSERT
    TO authenticated
    WITH CHECK (uploaded_by = auth.uid());

-- Authors: update own media
CREATE POLICY media_update_own ON public.media
    FOR UPDATE
    TO authenticated
    USING (uploaded_by = auth.uid())
    WITH CHECK (uploaded_by = auth.uid());

-- Authors: delete own media
CREATE POLICY media_delete_own ON public.media
    FOR DELETE
    TO authenticated
    USING (uploaded_by = auth.uid());
