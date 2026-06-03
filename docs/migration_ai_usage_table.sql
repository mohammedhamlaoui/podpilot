-- Create daily AI token usage tracking table
CREATE TABLE IF NOT EXISTS public.ai_usage (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day_key     text NOT NULL, -- Key format: 'YYYY-MM-DD'
  used_count  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Ensure a user can only have one row per day
CREATE UNIQUE INDEX IF NOT EXISTS ai_usage_user_day_idx ON public.ai_usage (user_id, day_key);

-- Index for speedy queries
CREATE INDEX IF NOT EXISTS ai_usage_user_idx ON public.ai_usage (user_id);

-- Enable Row Level Security (RLS)
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

-- Defense-in-depth policy: users can select their own usage
DROP POLICY IF EXISTS "ai_usage select own" ON public.ai_usage;
CREATE POLICY "ai_usage select own" ON public.ai_usage FOR SELECT USING (auth.uid() = user_id);
