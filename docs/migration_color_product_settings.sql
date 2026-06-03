-- Migration: Add color_settings, product_settings columns to designs table.
-- Run this in Supabase SQL Editor.

alter table public.designs
  add column if not exists color_settings jsonb default '{}',
  add column if not exists product_settings jsonb default '{}';

-- Ensure status-related columns exist.
alter table public.designs
  add column if not exists status text default 'pending',
  add column if not exists uploaded_at timestamptz,
  add column if not exists error_message text;

-- Ensure marketplace constraint exists (may already be there).
alter table public.designs
  drop constraint if exists designs_marketplace_check;

alter table public.designs
  add constraint designs_marketplace_check
  check (marketplace in ('redbubble', 'teepublic'));
