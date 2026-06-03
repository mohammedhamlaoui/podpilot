-- Add thumbnail R2 key column to designs table
ALTER TABLE public.designs ADD COLUMN IF NOT EXISTS thumbnail_r2_key text;
