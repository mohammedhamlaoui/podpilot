-- Free trial abuse prevention.
-- Stores only keyed hashes for email/device/IP/user-agent signals. Raw IP,
-- email, and device IDs should not be written to this table.

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

create index if not exists idx_trial_usage_user_id on public.trial_usage(user_id);
create index if not exists idx_trial_usage_email_hash on public.trial_usage(email_hash);
create index if not exists idx_trial_usage_device_hash on public.trial_usage(device_id_hash);
create index if not exists idx_trial_usage_ip_hash on public.trial_usage(ip_hash);
create index if not exists idx_trial_usage_paddle_customer on public.trial_usage(paddle_customer_id);

alter table public.trial_usage enable row level security;

-- The backend service-role client manages trial_usage. Browser clients should
-- not read these device/network hashes directly.
drop policy if exists "trial_usage no browser reads" on public.trial_usage;
create policy "trial_usage no browser reads"
  on public.trial_usage for select
  using (false);

-- Optional admin override used by backend/app/services/subscription_service.py.
-- Set true for a specific subscription row when support wants to allow a
-- one-off second trial despite prior hashed signal matches.
alter table public.subscriptions
  add column if not exists allow_trial_again boolean not null default false;
