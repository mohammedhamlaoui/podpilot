-- PodPilot Admin HQ foundation (additive, production application requires
-- separate approval). All privileged access remains backend/service-role only.

create table if not exists public.admin_principals (
  user_id uuid primary key references auth.users(id) on delete restrict,
  role text not null default 'owner' check (role in ('owner','support_readonly','finance','operations')),
  status text not null default 'active' check (status in ('active','disabled')),
  email text,
  capabilities text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_sessions (
  id text primary key,
  user_id uuid not null references public.admin_principals(user_id) on delete cascade,
  token_hash text not null unique,
  csrf_hash text not null,
  auth_level text not null check (auth_level in ('aal1','aal2')),
  authenticated_at timestamptz not null,
  last_seen_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists admin_sessions_user_active_idx
  on public.admin_sessions(user_id, expires_at) where revoked_at is null;

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.admin_principals(user_id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  reason text,
  previous_state jsonb,
  new_state jsonb,
  success boolean not null default true,
  request_id text,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_created_idx on public.admin_audit_logs(created_at desc);
create index if not exists admin_audit_target_idx on public.admin_audit_logs(target_type,target_id);

create table if not exists public.admin_security_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.admin_principals(user_id) on delete set null,
  event_type text not null,
  severity text not null default 'info' check (severity in ('info','warning','critical')),
  request_id text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists admin_security_created_idx on public.admin_security_events(created_at desc);

create table if not exists public.admin_settings (
  key text primary key,
  value jsonb not null,
  value_type text not null check (value_type in ('boolean','string','number','json')),
  description text,
  is_sensitive boolean not null default false,
  version integer not null default 1,
  updated_by uuid references public.admin_principals(user_id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.admin_settings(key,value,value_type,description,is_sensitive)
values
  ('maintenance_mode','false'::jsonb,'boolean','Temporarily place customer-facing PodPilot in maintenance mode.',false),
  ('public_announcement','""'::jsonb,'string','Public operational announcement displayed to customers.',false),
  ('uploads_enabled','true'::jsonb,'boolean','Allow browser-extension upload workflows.',false),
  ('ai_listing_enabled','true'::jsonb,'boolean','Allow AI listing generation requests.',false)
on conflict (key) do nothing;

create table if not exists public.admin_notifications (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  severity text not null default 'info' check (severity in ('info','warning','critical')),
  title text not null,
  message text not null,
  target_type text,
  target_id text,
  source_event_id text,
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.admin_principals(user_id) on delete set null,
  created_at timestamptz not null default now(),
  unique(event_type, source_event_id)
);

create table if not exists public.user_account_controls (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active','suspended','restricted')),
  reason text,
  changed_by uuid references public.admin_principals(user_id) on delete set null,
  changed_at timestamptz not null default now()
);

create table if not exists public.design_deletion_records (
  id uuid primary key default gen_random_uuid(),
  design_id uuid not null,
  customer_user_id uuid not null,
  marketplace text,
  filename text,
  object_keys_hash jsonb not null default '[]',
  deleted_object_count integer not null default 0,
  retained_shared_object_count integer not null default 0,
  status text not null check (status in ('previewed','completed','partial','failed')),
  reason text,
  actor_user_id uuid references public.admin_principals(user_id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.billing_transactions (
  paddle_transaction_id text primary key,
  customer_user_id uuid references auth.users(id) on delete set null,
  paddle_customer_id text,
  paddle_subscription_id text,
  status text not null,
  currency_code text,
  gross_amount_minor bigint,
  tax_amount_minor bigint,
  fee_amount_minor bigint,
  occurred_at timestamptz,
  payload_version integer not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_adjustments (
  paddle_adjustment_id text primary key,
  paddle_transaction_id text references public.billing_transactions(paddle_transaction_id) on delete set null,
  action text,
  status text not null,
  currency_code text,
  amount_minor bigint,
  occurred_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_request_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  provider text not null,
  model text,
  feature text not null,
  provider_request_id text,
  input_tokens bigint,
  output_tokens bigint,
  total_tokens bigint,
  latency_ms integer,
  status text not null check (status in ('succeeded','failed','unavailable')),
  error_code text,
  estimated_cost_usd numeric(14,6),
  pricing_version text,
  created_at timestamptz not null default now()
);
create index if not exists ai_request_usage_created_idx on public.ai_request_usage(created_at desc);
create index if not exists ai_request_usage_user_idx on public.ai_request_usage(user_id,created_at desc);

alter table public.admin_principals enable row level security;
alter table public.admin_sessions enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.admin_security_events enable row level security;
alter table public.admin_settings enable row level security;
alter table public.admin_notifications enable row level security;
alter table public.user_account_controls enable row level security;
alter table public.design_deletion_records enable row level security;
alter table public.billing_transactions enable row level security;
alter table public.billing_adjustments enable row level security;
alter table public.ai_request_usage enable row level security;

revoke all on public.admin_principals, public.admin_sessions,
  public.admin_audit_logs, public.admin_security_events, public.admin_settings,
  public.admin_notifications, public.user_account_controls,
  public.design_deletion_records, public.billing_transactions,
  public.billing_adjustments, public.ai_request_usage from anon, authenticated;

-- Provision the single Owner separately with the verified Supabase Auth UUID:
-- insert into public.admin_principals(user_id, role, status, email)
-- values ('OWNER_AUTH_UUID', 'owner', 'active', 'owner@example.com');
