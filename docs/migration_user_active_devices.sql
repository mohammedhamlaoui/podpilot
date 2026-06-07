-- Single-device account mode for PodPilot.
-- Run this in the Supabase SQL editor before enabling the device lock in production.

create extension if not exists pgcrypto;

create table if not exists public.user_active_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  device_label text,
  user_agent text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists idx_user_active_devices_user_id
  on public.user_active_devices (user_id);

create unique index if not exists idx_user_active_devices_one_active_per_user
  on public.user_active_devices (user_id)
  where revoked_at is null;

create index if not exists idx_user_active_devices_last_seen_at
  on public.user_active_devices (last_seen_at)
  where revoked_at is null;

alter table public.user_active_devices enable row level security;

drop policy if exists "user_active_devices_service_role_only" on public.user_active_devices;
create policy "user_active_devices_service_role_only"
  on public.user_active_devices
  for all
  using (false)
  with check (false);
