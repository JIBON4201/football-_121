-- ============================================================================
-- 022_media_variants.sql
-- Production Image/Media Processing (Step 27) support.
-- Backward compatible: existing media table untouched except an optional
-- idempotency key; canonical originals stay in media, generated renditions
-- live in media_variants. No changes to articles/SEO/news pipeline.
-- ============================================================================

-- Idempotency key for safe upload retries (nullable; unique when present).
ALTER TABLE public.media
    ADD COLUMN IF NOT EXISTS idempotency_key text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE indexname = 'uq_media_idempotency_key'
    ) THEN
        CREATE UNIQUE INDEX uq_media_idempotency_key
            ON public.media (idempotency_key)
            WHERE idempotency_key IS NOT NULL;
    END IF;
END
$$;

-- Generated renditions. Canonical original remains the parent media row.
CREATE TABLE IF NOT EXISTS public.media_variants (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    media_id     uuid        NOT NULL REFERENCES public.media(id) ON DELETE CASCADE,
    variant      varchar(32) NOT NULL,
    width        integer,
    height       integer,
    mime_type    varchar(100) NOT NULL,
    storage_path text        NOT NULL,
    public_url   text,
    file_size    bigint,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_media_variant UNIQUE (media_id, variant),
    CONSTRAINT chk_media_variant_name_empty CHECK (length(btrim(variant)) > 0),
    CONSTRAINT chk_media_variant_path_empty CHECK (length(btrim(storage_path)) > 0),
    CONSTRAINT chk_media_variant_width CHECK (width IS NULL OR width >= 0),
    CONSTRAINT chk_media_variant_height CHECK (height IS NULL OR height >= 0),
    CONSTRAINT chk_media_variant_file_size CHECK (file_size IS NULL OR file_size >= 0)
);

CREATE INDEX IF NOT EXISTS idx_media_variants_media_id ON public.media_variants (media_id);

ALTER TABLE public.media_variants ENABLE ROW LEVEL SECURITY;

-- Public read: variants of media visible to the public (published-article
-- featured images). Mirrors the parent media policy without duplicating logic.
DROP POLICY IF EXISTS media_variants_select_published ON public.media_variants;
CREATE POLICY media_variants_select_published ON public.media_variants
    FOR SELECT
    TO anon, authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.media m
            JOIN public.articles a ON a.featured_image_id = m.id
            WHERE m.id = media_variants.media_id
              AND a.status = 'published'
              AND a.published_at IS NOT NULL
        )
    );

-- Authors manage variants only through the Media Service (service role);
-- editor-facing variant writes go through the same service path.
-- No direct client INSERT/UPDATE/DELETE policies by design.
