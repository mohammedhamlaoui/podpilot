-- PodPilot migration: Add ai_tokens column & update plan check constraint
-- Run this in the Supabase SQL Editor once.

-- 1. Add ai_tokens column if not exists
ALTER TABLE public.subscriptions 
ADD COLUMN IF NOT EXISTS ai_tokens integer NOT NULL DEFAULT 0;

-- 2. Comment column for documentation
COMMENT ON COLUMN public.subscriptions.ai_tokens IS 'The remaining purchased one-time AI tokens for the user account.';

-- 3. Drop and recreate check constraint to allow new plans
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_check;

ALTER TABLE public.subscriptions 
ADD CONSTRAINT subscriptions_plan_check 
CHECK (plan IN ('starter', 'growth', 'pro', 'redbubble', 'teepublic', 'all_platforms'));
