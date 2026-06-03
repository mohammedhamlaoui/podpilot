-- Add ai_preview_r2_key column to designs table
ALTER TABLE public.designs ADD COLUMN IF NOT EXISTS ai_preview_r2_key text;
