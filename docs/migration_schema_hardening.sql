-- PodPilot migration: safe additive production schema hardening.
-- Run this in the Supabase SQL Editor when ready.
--
-- This migration is intentionally non-destructive:
-- - no table or column renames
-- - no column drops
-- - foreign keys are added as NOT VALID
-- - constraints are checked in pg_catalog before creation

ALTER TABLE public.designs
ADD COLUMN IF NOT EXISTS cleanup_at timestamptz;

UPDATE public.designs
SET cleanup_at = created_at + interval '20 days'
WHERE cleanup_at IS NULL
  AND created_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS designs_cleanup_at_idx
ON public.designs (cleanup_at);

DO $$
BEGIN
  IF to_regclass('public.upload_logs') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM pg_constraint
        WHERE conname = 'upload_logs_message_len_check'
          AND conrelid = 'public.upload_logs'::regclass
     ) THEN
    ALTER TABLE public.upload_logs
    ADD CONSTRAINT upload_logs_message_len_check
    CHECK (message IS NULL OR length(message) <= 4000) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.upload_logs') IS NOT NULL
     AND to_regclass('public.designs') IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'upload_logs'
          AND column_name = 'design_id'
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_constraint
        WHERE conname = 'upload_logs_design_id_fkey'
          AND conrelid = 'public.upload_logs'::regclass
     ) THEN
    ALTER TABLE public.upload_logs
    ADD CONSTRAINT upload_logs_design_id_fkey
    FOREIGN KEY (design_id) REFERENCES public.designs(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.upload_logs') IS NOT NULL
     AND to_regclass('public.upload_jobs') IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'upload_logs'
          AND column_name = 'job_id'
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_constraint
        WHERE conname = 'upload_logs_job_id_fkey'
          AND conrelid = 'public.upload_logs'::regclass
     ) THEN
    ALTER TABLE public.upload_logs
    ADD CONSTRAINT upload_logs_job_id_fkey
    FOREIGN KEY (job_id) REFERENCES public.upload_jobs(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.cleanup_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'running',
  dry_run boolean NOT NULL DEFAULT true,
  cutoff_at timestamptz,
  deleted_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
