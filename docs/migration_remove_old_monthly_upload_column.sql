-- Optional cleanup migration for databases that still have the legacy quota
-- column. Run manually in Supabase only after confirming production no longer
-- reads or writes subscriptions.monthly_upload_limit.

alter table if exists public.subscriptions
  drop column if exists monthly_upload_limit;
