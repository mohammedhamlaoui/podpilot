-- PodPilot migration: Paddle checkout intent idempotency.
-- Run this once in the Supabase SQL Editor before deploying checkout intent code.

create table if not exists public.paddle_checkout_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  intent_type text not null
    check (intent_type in ('subscription', 'ai_credits')),
  plan_key text,
  billing_interval text,
  credit_pack_id text,
  selected_price_id text not null,
  status text not null default 'pending'
    check (status in ('pending', 'opened', 'paid', 'canceled', 'expired', 'failed')),
  idempotency_key text not null,
  paddle_transaction_id text,
  paddle_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create index if not exists paddle_checkout_intents_user_created_idx
  on public.paddle_checkout_intents (user_id, created_at desc);

create index if not exists paddle_checkout_intents_status_created_idx
  on public.paddle_checkout_intents (status, created_at desc);

create unique index if not exists paddle_checkout_intents_transaction_uidx
  on public.paddle_checkout_intents (paddle_transaction_id)
  where paddle_transaction_id is not null;

create unique index if not exists paddle_checkout_intents_subscription_uidx
  on public.paddle_checkout_intents (paddle_subscription_id)
  where paddle_subscription_id is not null;

alter table public.paddle_checkout_intents enable row level security;

drop policy if exists "paddle_checkout_intents no browser reads"
  on public.paddle_checkout_intents;
create policy "paddle_checkout_intents no browser reads"
  on public.paddle_checkout_intents for select
  using (false);

-- Additional hardening for existing Paddle ledgers.
create unique index if not exists subscriptions_paddle_subscription_uidx
  on public.subscriptions (paddle_subscription_id)
  where paddle_subscription_id is not null;

create unique index if not exists paddle_token_credits_transaction_uidx
  on public.paddle_token_credits (transaction_id);
