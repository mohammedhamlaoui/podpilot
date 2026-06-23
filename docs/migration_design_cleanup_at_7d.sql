-- PodPilot migration: extend design auto-delete deadlines to 7 days.
-- Run this in the Supabase SQL Editor when ready.
--
-- This is idempotent and non-destructive. It does not restore already
-- deleted designs; it only extends rows whose cleanup_at deadline is still
-- in the future and shorter than the current 7-day policy.
--
-- Auto-delete rule:
--   cleanup_at = created_at + interval '7 days'
--
-- Do not update cleanup_at on normal metadata/editor/status changes.

ALTER TABLE public.designs
ADD COLUMN IF NOT EXISTS cleanup_at timestamptz;

UPDATE public.designs
SET cleanup_at = created_at + interval '7 days',
    updated_at = now()
WHERE cleanup_at IS NOT NULL
  AND cleanup_at > now()
  AND created_at IS NOT NULL
  AND cleanup_at < created_at + interval '7 days';

CREATE INDEX IF NOT EXISTS designs_cleanup_at_idx
ON public.designs (cleanup_at);
