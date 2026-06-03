-- PodPilot Supabase schema (reference only).
-- Run this once in Supabase → SQL editor if the tables don't already exist.
-- The backend uses the service-role key and bypasses RLS, but RLS is
-- defined here as defense-in-depth so anon/authenticated keys can never
-- read another user's rows directly from the browser.

-- ── design ─────────────────────────────────────────────────────────────
create table if not exists public.design (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  marketplace       text not null check (marketplace in ('redbubble','teepublic')),
  filename          text not null,
  title             text default '',
  description       text default '',
  primary_tag       text default '',
  supporting_tags   text[] default '{}',
  copy_link         text default '',
  image_r2_key      text,
  excel_r2_key      text,
  status            text not null default 'pending'
                      check (status in ('pending','uploading','uploaded','failed')),
  error_message     text,
  redbubble_work_id text,
  adult_content     boolean default false,
  color_settings    jsonb default '{}',
  product_settings  jsonb default '{}',
  source_row        int,
  uploaded_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz
);

create index if not exists design_user_id_idx       on public.design (user_id);
create index if not exists design_user_status_idx   on public.design (user_id, status);
create index if not exists design_user_market_idx   on public.design (user_id, marketplace);

-- ── upload_jobs ────────────────────────────────────────────────────────
create table if not exists public.upload_jobs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  marketplace     text not null check (marketplace in ('redbubble','teepublic')),
  excel_r2_key    text,
  status          text not null default 'pending'
                    check (status in ('pending','running','completed','failed')),
  total_designs   int default 0,
  created_at      timestamptz not null default now(),
  finished_at     timestamptz
);

create index if not exists upload_jobs_user_idx on public.upload_jobs (user_id);

-- ── upload_logs ────────────────────────────────────────────────────────
create table if not exists public.upload_logs (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  design_id         uuid references public.design(id) on delete cascade,
  status            text not null,
  stage             text,
  error_message     text,
  redbubble_work_id text,
  created_at        timestamptz not null default now()
);

create index if not exists upload_logs_user_idx   on public.upload_logs (user_id);
create index if not exists upload_logs_design_idx on public.upload_logs (design_id);

-- ── Row-Level Security ─────────────────────────────────────────────────
alter table public.design       enable row level security;
alter table public.upload_jobs  enable row level security;
alter table public.upload_logs  enable row level security;

-- Users may read/write only their own rows from the browser. The backend
-- uses the service-role key and bypasses these policies entirely.
drop policy if exists "design select own"  on public.design;
drop policy if exists "design insert own"  on public.design;
drop policy if exists "design update own"  on public.design;
drop policy if exists "design delete own"  on public.design;

create policy "design select own"  on public.design for select using (auth.uid() = user_id);
create policy "design insert own"  on public.design for insert with check (auth.uid() = user_id);
create policy "design update own"  on public.design for update using (auth.uid() = user_id);
create policy "design delete own"  on public.design for delete using (auth.uid() = user_id);

drop policy if exists "upload_jobs select own"  on public.upload_jobs;
drop policy if exists "upload_jobs insert own"  on public.upload_jobs;
drop policy if exists "upload_jobs update own"  on public.upload_jobs;
drop policy if exists "upload_jobs delete own"  on public.upload_jobs;

create policy "upload_jobs select own"  on public.upload_jobs for select using (auth.uid() = user_id);
create policy "upload_jobs insert own"  on public.upload_jobs for insert with check (auth.uid() = user_id);
create policy "upload_jobs update own"  on public.upload_jobs for update using (auth.uid() = user_id);
create policy "upload_jobs delete own"  on public.upload_jobs for delete using (auth.uid() = user_id);

drop policy if exists "upload_logs select own"  on public.upload_logs;
drop policy if exists "upload_logs insert own"  on public.upload_logs;

create policy "upload_logs select own"  on public.upload_logs for select using (auth.uid() = user_id);
create policy "upload_logs insert own"  on public.upload_logs for insert with check (auth.uid() = user_id);
