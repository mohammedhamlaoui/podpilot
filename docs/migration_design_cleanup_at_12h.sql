-- PodPilot migration: fixed 12-hour design auto-delete deadlines.
-- Run this in the Supabase SQL Editor when ready.
--
-- This is idempotent and non-destructive. It adds cleanup_at, backfills old
-- rows from their original created_at timestamp, and indexes cleanup_at for
-- periodic cleanup scans.
--
-- Auto-delete rule:
--   cleanup_at = created_at + interval '12 hours'
--
-- Do not update cleanup_at on normal metadata/editor/status changes.

ALTER TABLE public.designs
ADD COLUMN IF NOT EXISTS cleanup_at timestamptz;

UPDATE public.designs
SET cleanup_at = created_at + interval '12 hours'
WHERE cleanup_at IS NULL
  AND created_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS designs_cleanup_at_idx
ON public.designs (cleanup_at);
