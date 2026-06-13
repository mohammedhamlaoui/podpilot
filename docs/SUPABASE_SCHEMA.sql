-- PodPilot canonical Supabase schema reference.
--
-- This file documents the schema shape expected by the live backend.
-- It is intentionally additive/reference-safe: it does not rename or drop
-- live tables. Run targeted migration files for existing production DBs.
--
-- Important naming:
-- - The live backend uses public.designs, not public.design.
-- - The backend stores the platform value in the column named marketplace.
-- - Design images, thumbnails, Excel imports, and AI previews are stored in
--   Cloudflare R2. Database rows store R2 object keys only, never signed URLs,
--   image blobs, or base64 image payloads. Signed URLs are generated at API
--   response time.

-- Users / profiles ---------------------------------------------------------
-- PodPilot uses Supabase Auth's auth.users table as the user source of truth.
-- No public.profiles table is currently required by the live backend.

-- Designs -----------------------------------------------------------------
create table if not exists public.designs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  marketplace text not null
    check (marketplace in ('redbubble', 'teepublic')),
  filename text not null,
  title text default '',
  description text default '',
  primary_tag text default '',
  supporting_tags text[] default '{}',
  copy_link text default '',

  -- R2 object keys only. Do not store signed URLs or image/base64 payloads.
  image_r2_key text,
  thumbnail_r2_key text,
  excel_r2_key text,
  ai_preview_r2_key text,

  status text not null default 'pending'
    check (status in ('pending', 'uploading', 'uploaded', 'failed')),
  error_message text,
  adult_content boolean default false,
  color_settings jsonb default '{}',
  product_settings jsonb default '{}',
  uploaded_at timestamptz,
  created_at timestamptz not null default now(),
  cleanup_at timestamptz,
  updated_at timestamptz
);

create index if not exists designs_user_id_idx
  on public.designs (user_id);
create index if not exists designs_user_status_idx
  on public.designs (user_id, status);
create index if not exists designs_user_marketplace_idx
  on public.designs (user_id, marketplace);
create index if not exists designs_user_created_at_idx
  on public.designs (user_id, created_at);
create index if not exists designs_user_marketplace_created_at_idx
  on public.designs (user_id, marketplace, created_at);
create index if not exists designs_user_status_created_at_idx
  on public.designs (user_id, status, created_at);
create index if not exists designs_created_at_idx
  on public.designs (created_at);
create index if not exists designs_cleanup_at_idx
  on public.designs (cleanup_at);

-- Upload jobs --------------------------------------------------------------
create table if not exists public.upload_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Backend/API platform value is stored as marketplace.
  marketplace text not null
    check (marketplace in ('redbubble', 'teepublic')),

  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed')),
  total_designs integer not null default 0,
  uploaded_count integer not null default 0,
  failed_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index if not exists upload_jobs_user_idx
  on public.upload_jobs (user_id);
create index if not exists upload_jobs_user_created_at_idx
  on public.upload_jobs (user_id, created_at);
create index if not exists upload_jobs_user_marketplace_created_at_idx
  on public.upload_jobs (user_id, marketplace, created_at);
create index if not exists upload_jobs_user_status_created_at_idx
  on public.upload_jobs (user_id, status, created_at);

-- Upload logs --------------------------------------------------------------
create table if not exists public.upload_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  design_id uuid references public.designs(id) on delete cascade,
  job_id uuid references public.upload_jobs(id) on delete set null,
  level text not null default 'info'
    check (level in ('info', 'warn', 'error')),
  message text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists upload_logs_user_idx
  on public.upload_logs (user_id);
create index if not exists upload_logs_design_idx
  on public.upload_logs (design_id);
create index if not exists upload_logs_job_idx
  on public.upload_logs (job_id);
create index if not exists upload_logs_user_created_at_idx
  on public.upload_logs (user_id, created_at);
create index if not exists upload_logs_user_design_created_at_idx
  on public.upload_logs (user_id, design_id, created_at);
create index if not exists upload_logs_user_job_created_at_idx
  on public.upload_logs (user_id, job_id, created_at);

-- Subscriptions ------------------------------------------------------------
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan text
    check (plan is null or plan in (
      'redbubble',
      'teepublic',
      'all_platforms'
    )),
  status text not null default 'inactive'
    check (status in (
      'trialing',
      'active',
      'past_due',
      'paused',
      'canceled',
      'inactive'
    )),
  paddle_customer_id text,
  paddle_subscription_id text,
  paddle_price_id text,
  trial_starts_at timestamptz,
  trial_ends_at timestamptz,
  current_period_starts_at timestamptz,
  current_period_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  billing_anchor timestamptz,
  billing_cycle text check (billing_cycle is null or billing_cycle in ('monthly', 'annual')),
  ai_tokens integer not null default 0,
  allow_trial_again boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_user_idx
  on public.subscriptions (user_id);
create index if not exists subscriptions_user_updated_created_idx
  on public.subscriptions (user_id, updated_at, created_at);
create index if not exists subscriptions_paddle_subscription_idx
  on public.subscriptions (paddle_subscription_id);
create unique index if not exists subscriptions_paddle_subscription_uidx
  on public.subscriptions (paddle_subscription_id)
  where paddle_subscription_id is not null;
create index if not exists subscriptions_paddle_customer_idx
  on public.subscriptions (paddle_customer_id);

-- Monthly upload usage -----------------------------------------------------
create table if not exists public.upload_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  month_key text not null,
  uploaded_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, month_key)
);

create index if not exists upload_usage_user_idx
  on public.upload_usage (user_id);

-- Daily AI token usage -----------------------------------------------------
create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day_key text not null,
  used_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ai_usage_user_day_idx
  on public.ai_usage (user_id, day_key);
create index if not exists ai_usage_user_idx
  on public.ai_usage (user_id);

-- AI credit purchases / Paddle ledgers ------------------------------------
create table if not exists public.paddle_webhook_events (
  event_id text primary key,
  event_type text not null,
  notification_id text,
  transaction_id text,
  status text not null default 'processing'
    check (status in ('processing', 'processed', 'ignored', 'failed')),
  attempts integer not null default 1,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now(),
  last_error text
);

create index if not exists paddle_webhook_events_event_type_idx
  on public.paddle_webhook_events (event_type);
create index if not exists paddle_webhook_events_transaction_id_idx
  on public.paddle_webhook_events (transaction_id);

create table if not exists public.paddle_token_credits (
  transaction_id text primary key,
  event_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  tokens integer not null check (tokens > 0),
  status text not null default 'processing'
    check (status in ('processing', 'credited', 'failed')),
  created_at timestamptz not null default now(),
  credited_at timestamptz,
  updated_at timestamptz not null default now(),
  last_error text
);

create unique index if not exists paddle_token_credits_event_id_uidx
  on public.paddle_token_credits (event_id);
create unique index if not exists paddle_token_credits_transaction_uidx
  on public.paddle_token_credits (transaction_id);
create index if not exists paddle_token_credits_user_id_idx
  on public.paddle_token_credits (user_id);

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

-- Trial abuse-prevention ledger -------------------------------------------
-- Stores only keyed hashes for email/device/IP/user-agent signals. Raw IP,
-- raw email, and raw device IDs should not be stored in this table.
create table if not exists public.trial_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  email_hash text,
  paddle_customer_id text,
  device_id_hash text,
  ip_hash text,
  user_agent_hash text,
  trial_started_at timestamptz default now(),
  trial_ended_at timestamptz,
  plan_key text,
  created_at timestamptz default now()
);

create index if not exists trial_usage_user_id_idx
  on public.trial_usage (user_id);
create index if not exists trial_usage_email_hash_idx
  on public.trial_usage (email_hash);
create index if not exists trial_usage_device_hash_idx
  on public.trial_usage (device_id_hash);
create index if not exists trial_usage_ip_hash_idx
  on public.trial_usage (ip_hash);
create index if not exists trial_usage_paddle_customer_idx
  on public.trial_usage (paddle_customer_id);

-- Cleanup -----------------------------------------------------------------
-- The current backend does not use a cleanup_records / cleanup_jobs table.
-- Storage cleanup reads public.designs rows by cleanup_at when present.
-- Older rows with cleanup_at null fall back to created_at <= now() - 12 hours.
-- The backend sets cleanup_at to created_at + interval '12 hours' once after
-- row creation. Do not update cleanup_at on metadata/editor/status changes.
-- Cleanup deletes referenced R2 keys from image_r2_key, thumbnail_r2_key,
-- excel_r2_key, and ai_preview_r2_key when present.

-- Row-level security -------------------------------------------------------
alter table public.designs enable row level security;
alter table public.upload_jobs enable row level security;
alter table public.upload_logs enable row level security;
alter table public.subscriptions enable row level security;
alter table public.upload_usage enable row level security;
alter table public.ai_usage enable row level security;
alter table public.paddle_webhook_events enable row level security;
alter table public.paddle_token_credits enable row level security;
alter table public.paddle_checkout_intents enable row level security;
alter table public.trial_usage enable row level security;

-- Browser clients may read/write only their own operational rows. The backend
-- uses the service-role key and still scopes user-facing operations by user_id.
drop policy if exists "designs select own" on public.designs;
drop policy if exists "designs insert own" on public.designs;
drop policy if exists "designs update own" on public.designs;
drop policy if exists "designs delete own" on public.designs;

create policy "designs select own" on public.designs
  for select using (auth.uid() = user_id);
create policy "designs insert own" on public.designs
  for insert with check (auth.uid() = user_id);
create policy "designs update own" on public.designs
  for update using (auth.uid() = user_id);
create policy "designs delete own" on public.designs
  for delete using (auth.uid() = user_id);

drop policy if exists "upload_jobs select own" on public.upload_jobs;
drop policy if exists "upload_jobs insert own" on public.upload_jobs;
drop policy if exists "upload_jobs update own" on public.upload_jobs;
drop policy if exists "upload_jobs delete own" on public.upload_jobs;

create policy "upload_jobs select own" on public.upload_jobs
  for select using (auth.uid() = user_id);
create policy "upload_jobs insert own" on public.upload_jobs
  for insert with check (auth.uid() = user_id);
create policy "upload_jobs update own" on public.upload_jobs
  for update using (auth.uid() = user_id);
create policy "upload_jobs delete own" on public.upload_jobs
  for delete using (auth.uid() = user_id);

drop policy if exists "upload_logs select own" on public.upload_logs;
drop policy if exists "upload_logs insert own" on public.upload_logs;

create policy "upload_logs select own" on public.upload_logs
  for select using (auth.uid() = user_id);
create policy "upload_logs insert own" on public.upload_logs
  for insert with check (auth.uid() = user_id);

drop policy if exists "subscriptions select own" on public.subscriptions;
create policy "subscriptions select own" on public.subscriptions
  for select using (auth.uid() = user_id);

drop policy if exists "upload_usage select own" on public.upload_usage;
create policy "upload_usage select own" on public.upload_usage
  for select using (auth.uid() = user_id);

drop policy if exists "ai_usage select own" on public.ai_usage;
create policy "ai_usage select own" on public.ai_usage
  for select using (auth.uid() = user_id);

-- Service-role code manages billing ledgers and trial hashes. Browser clients
-- should not read those internal records directly.
drop policy if exists "paddle_webhook_events no browser reads" on public.paddle_webhook_events;
create policy "paddle_webhook_events no browser reads" on public.paddle_webhook_events
  for select using (false);

drop policy if exists "paddle_token_credits no browser reads" on public.paddle_token_credits;
create policy "paddle_token_credits no browser reads" on public.paddle_token_credits
  for select using (false);

drop policy if exists "paddle_checkout_intents no browser reads" on public.paddle_checkout_intents;
create policy "paddle_checkout_intents no browser reads" on public.paddle_checkout_intents
  for select using (false);

drop policy if exists "trial_usage no browser reads" on public.trial_usage;
create policy "trial_usage no browser reads" on public.trial_usage
  for select using (false);
