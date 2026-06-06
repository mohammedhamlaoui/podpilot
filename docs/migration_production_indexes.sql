-- PodPilot migration: production indexes for Supabase/Postgres query paths.
-- Run this in the Supabase SQL Editor once.
--
-- Notes:
-- - The application calls the platform column `marketplace`.
-- - This migration checks pg_catalog for equivalent btree indexes before
--   creating a new one, so it avoids duplicates even when an existing index
--   has a different name.

CREATE OR REPLACE FUNCTION pg_temp.podpilot_column_exists(
  p_schema text,
  p_table text,
  p_column text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = p_schema
       AND table_name = p_table
       AND column_name = p_column
  );
$$;

CREATE OR REPLACE FUNCTION pg_temp.podpilot_btree_index_exists(
  p_schema text,
  p_table text,
  p_columns text[],
  p_predicate text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM pg_index i
      JOIN pg_class t
        ON t.oid = i.indrelid
      JOIN pg_namespace n
        ON n.oid = t.relnamespace
      JOIN pg_class idx
        ON idx.oid = i.indexrelid
      JOIN pg_am am
        ON am.oid = idx.relam
      JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
        ON k.ord <= i.indnkeyatts
      JOIN pg_attribute a
        ON a.attrelid = t.oid
       AND a.attnum = k.attnum
     WHERE n.nspname = p_schema
       AND t.relname = p_table
       AND am.amname = 'btree'
       AND i.indisvalid
       AND i.indisready
       AND coalesce(pg_get_expr(i.indpred, i.indrelid), '') = coalesce(p_predicate, '')
     GROUP BY i.indexrelid
    HAVING array_agg(a.attname::text ORDER BY k.ord) = p_columns
  );
$$;

DO $$
BEGIN
  IF to_regclass('public.designs') IS NOT NULL THEN
    IF NOT pg_temp.podpilot_btree_index_exists('public', 'designs', ARRAY['user_id', 'created_at']) THEN
      CREATE INDEX IF NOT EXISTS podpilot_designs_user_created_at_idx
        ON public.designs (user_id, created_at);
    END IF;

    IF NOT pg_temp.podpilot_btree_index_exists('public', 'designs', ARRAY['user_id', 'marketplace', 'created_at']) THEN
      CREATE INDEX IF NOT EXISTS podpilot_designs_user_marketplace_created_at_idx
        ON public.designs (user_id, marketplace, created_at);
    END IF;

    IF NOT pg_temp.podpilot_btree_index_exists('public', 'designs', ARRAY['user_id', 'status', 'created_at']) THEN
      CREATE INDEX IF NOT EXISTS podpilot_designs_user_status_created_at_idx
        ON public.designs (user_id, status, created_at);
    END IF;

    IF NOT pg_temp.podpilot_btree_index_exists('public', 'designs', ARRAY['created_at']) THEN
      CREATE INDEX IF NOT EXISTS podpilot_designs_created_at_idx
        ON public.designs (created_at);
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.upload_jobs') IS NOT NULL THEN
    IF NOT pg_temp.podpilot_btree_index_exists('public', 'upload_jobs', ARRAY['user_id', 'created_at']) THEN
      CREATE INDEX IF NOT EXISTS podpilot_upload_jobs_user_created_at_idx
        ON public.upload_jobs (user_id, created_at);
    END IF;

    IF NOT pg_temp.podpilot_btree_index_exists('public', 'upload_jobs', ARRAY['user_id', 'marketplace', 'created_at']) THEN
      CREATE INDEX IF NOT EXISTS podpilot_upload_jobs_user_marketplace_created_at_idx
        ON public.upload_jobs (user_id, marketplace, created_at);
    END IF;

    IF NOT pg_temp.podpilot_btree_index_exists('public', 'upload_jobs', ARRAY['user_id', 'status', 'created_at']) THEN
      CREATE INDEX IF NOT EXISTS podpilot_upload_jobs_user_status_created_at_idx
        ON public.upload_jobs (user_id, status, created_at);
    END IF;

    IF NOT pg_temp.podpilot_btree_index_exists('public', 'upload_jobs', ARRAY['created_at']) THEN
      CREATE INDEX IF NOT EXISTS podpilot_upload_jobs_created_at_idx
        ON public.upload_jobs (created_at);
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.upload_logs') IS NOT NULL THEN
    IF NOT pg_temp.podpilot_btree_index_exists('public', 'upload_logs', ARRAY['user_id', 'created_at']) THEN
      CREATE INDEX IF NOT EXISTS podpilot_upload_logs_user_created_at_idx
        ON public.upload_logs (user_id, created_at);
    END IF;

    IF pg_temp.podpilot_column_exists('public', 'upload_logs', 'design_id')
       AND NOT pg_temp.podpilot_btree_index_exists('public', 'upload_logs', ARRAY['user_id', 'design_id', 'created_at']) THEN
      CREATE INDEX IF NOT EXISTS podpilot_upload_logs_user_design_created_at_idx
        ON public.upload_logs (user_id, design_id, created_at);
    END IF;

    IF pg_temp.podpilot_column_exists('public', 'upload_logs', 'job_id')
       AND NOT pg_temp.podpilot_btree_index_exists('public', 'upload_logs', ARRAY['user_id', 'job_id', 'created_at']) THEN
      CREATE INDEX IF NOT EXISTS podpilot_upload_logs_user_job_created_at_idx
        ON public.upload_logs (user_id, job_id, created_at);
    END IF;

    IF pg_temp.podpilot_column_exists('public', 'upload_logs', 'status')
       AND NOT pg_temp.podpilot_btree_index_exists('public', 'upload_logs', ARRAY['user_id', 'status', 'created_at']) THEN
      CREATE INDEX IF NOT EXISTS podpilot_upload_logs_user_status_created_at_idx
        ON public.upload_logs (user_id, status, created_at);
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.subscriptions') IS NOT NULL THEN
    IF NOT pg_temp.podpilot_btree_index_exists('public', 'subscriptions', ARRAY['user_id', 'updated_at', 'created_at']) THEN
      CREATE INDEX IF NOT EXISTS podpilot_subscriptions_user_updated_created_idx
        ON public.subscriptions (user_id, updated_at, created_at);
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.cleanup_jobs') IS NOT NULL THEN
    IF pg_temp.podpilot_column_exists('public', 'cleanup_jobs', 'user_id')
       AND NOT pg_temp.podpilot_btree_index_exists('public', 'cleanup_jobs', ARRAY['user_id', 'created_at']) THEN
      CREATE INDEX IF NOT EXISTS podpilot_cleanup_jobs_user_created_at_idx
        ON public.cleanup_jobs (user_id, created_at);
    END IF;

    IF pg_temp.podpilot_column_exists('public', 'cleanup_jobs', 'platform')
       AND NOT pg_temp.podpilot_btree_index_exists('public', 'cleanup_jobs', ARRAY['user_id', 'platform']) THEN
      CREATE INDEX IF NOT EXISTS podpilot_cleanup_jobs_user_platform_idx
        ON public.cleanup_jobs (user_id, platform);
    END IF;

    IF pg_temp.podpilot_column_exists('public', 'cleanup_jobs', 'marketplace')
       AND NOT pg_temp.podpilot_btree_index_exists('public', 'cleanup_jobs', ARRAY['user_id', 'marketplace']) THEN
      CREATE INDEX IF NOT EXISTS podpilot_cleanup_jobs_user_marketplace_idx
        ON public.cleanup_jobs (user_id, marketplace);
    END IF;

    IF pg_temp.podpilot_column_exists('public', 'cleanup_jobs', 'status')
       AND NOT pg_temp.podpilot_btree_index_exists('public', 'cleanup_jobs', ARRAY['user_id', 'status']) THEN
      CREATE INDEX IF NOT EXISTS podpilot_cleanup_jobs_user_status_idx
        ON public.cleanup_jobs (user_id, status);
    END IF;

    IF pg_temp.podpilot_column_exists('public', 'cleanup_jobs', 'cleanup_at')
       AND NOT pg_temp.podpilot_btree_index_exists('public', 'cleanup_jobs', ARRAY['cleanup_at']) THEN
      CREATE INDEX IF NOT EXISTS podpilot_cleanup_jobs_cleanup_at_idx
        ON public.cleanup_jobs (cleanup_at);
    END IF;

    IF pg_temp.podpilot_column_exists('public', 'cleanup_jobs', 'cleanup_at')
       AND pg_temp.podpilot_column_exists('public', 'cleanup_jobs', 'status')
       AND NOT EXISTS (
         SELECT 1
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename = 'cleanup_jobs'
            AND indexdef ILIKE '%cleanup_at%'
            AND indexdef ILIKE '%WHERE%'
            AND indexdef ILIKE '%pending%'
       ) THEN
      CREATE INDEX IF NOT EXISTS podpilot_cleanup_jobs_pending_cleanup_at_idx
        ON public.cleanup_jobs (cleanup_at)
        WHERE status = 'pending';
    END IF;
  END IF;
END $$;

-- Existing migration_ai_usage_table.sql already creates:
-- - ai_usage_user_day_idx on public.ai_usage (user_id, day_key)
-- - ai_usage_user_idx on public.ai_usage (user_id)
-- Those cover the daily AI token usage user_id + date lookups, so this
-- migration intentionally does not add duplicate ai_usage indexes.
