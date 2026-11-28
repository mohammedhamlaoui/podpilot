-- Missing optional column confirmed in production preflight/canary.
-- Nullable addition; existing subscription records are not backfilled or changed.
BEGIN;
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS billing_cycle text CHECK (billing_cycle IN ('monthly','annual'));
COMMIT;
