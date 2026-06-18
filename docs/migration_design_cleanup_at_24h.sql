-- PodPilot migration: fixed 24-hour design auto-delete deadlines.
-- Run this in the Supabase SQL Editor when ready.
--
-- This is idempotent and non-destructive. It adds cleanup_at, backfills rows
-- from their original created_at timestamp, extends deadlines that still use
-- the former 12-hour policy, and indexes cleanup_at for periodic cleanup scans.
--
-- Auto-delete rule:
--   cleanup_at = created_at + interval '24 hours'
--
-- Do not update cleanup_at on normal metadata/editor/status changes.

ALTER TABLE public.designs
ADD COLUMN IF NOT EXISTS cleanup_at timestamptz;

UPDATE public.designs
SET cleanup_at = created_at + interval '24 hours'
WHERE (cleanup_at IS NULL OR cleanup_at = created_at + interval '12 hours')
  AND created_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS designs_cleanup_at_idx
ON public.designs (cleanup_at);
