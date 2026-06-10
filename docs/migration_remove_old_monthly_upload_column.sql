-- Migration: Remove legacy monthly_upload_limit column from subscriptions table
-- Purpose: Clean up old billing limits since PodPilot is now on the unlimited upload subscription model.
-- 
-- WARNING: This migration is optional and safe. It drops the monthly_upload_limit column.
-- Run this target script in your Supabase SQL editor when ready to clean the database schema.

ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS monthly_upload_limit;
