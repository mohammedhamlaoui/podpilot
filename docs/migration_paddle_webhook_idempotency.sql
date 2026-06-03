-- PodPilot migration: Paddle webhook replay/idempotency ledgers.
-- Run this once in the Supabase SQL Editor before deploying the webhook code.

CREATE TABLE IF NOT EXISTS public.paddle_webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  notification_id text,
  transaction_id text,
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'processed', 'ignored', 'failed')),
  attempts integer NOT NULL DEFAULT 1,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_error text
);

CREATE INDEX IF NOT EXISTS paddle_webhook_events_event_type_idx
  ON public.paddle_webhook_events (event_type);

CREATE INDEX IF NOT EXISTS paddle_webhook_events_transaction_id_idx
  ON public.paddle_webhook_events (transaction_id);

ALTER TABLE public.paddle_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.paddle_token_credits (
  transaction_id text PRIMARY KEY,
  event_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tokens integer NOT NULL CHECK (tokens > 0),
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'credited', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  credited_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_error text
);

CREATE UNIQUE INDEX IF NOT EXISTS paddle_token_credits_event_id_uidx
  ON public.paddle_token_credits (event_id);

CREATE INDEX IF NOT EXISTS paddle_token_credits_user_id_idx
  ON public.paddle_token_credits (user_id);

ALTER TABLE public.paddle_token_credits ENABLE ROW LEVEL SECURITY;
