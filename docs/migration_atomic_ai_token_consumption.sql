-- PodPilot migration: Atomic AI token consumption
-- Run this in the Supabase SQL Editor once.
-- Historical baseline: follow with migration_billing_lifecycle_safety.sql before
-- enabling AI. Do not replay this baseline over an upgraded lifecycle function.

CREATE OR REPLACE FUNCTION public.consume_ai_token_atomic(p_user_id uuid)
RETURNS TABLE (
  token_source text,
  remaining_daily integer,
  remaining_extra integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_subscription public.subscriptions%ROWTYPE;
  v_day_key text := to_char(timezone('UTC', now()), 'YYYY-MM-DD');
  v_daily_limit integer := 0;
  v_used_count integer := 0;
  v_remaining_extra integer := 0;
  v_status text := 'inactive';
  v_plan text := '';
  v_is_current boolean := false;
BEGIN
  SELECT *
    INTO v_subscription
    FROM public.subscriptions
   WHERE user_id = p_user_id
   ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_status := lower(coalesce(v_subscription.status, 'inactive'));
  v_plan := lower(coalesce(v_subscription.plan, ''));
  v_is_current :=
    v_status IN ('trialing', 'active')
    OR (
      v_status = 'canceled'
      AND v_subscription.current_period_ends_at IS NOT NULL
      AND v_subscription.current_period_ends_at > now()
    );

  IF v_is_current THEN
    v_daily_limit := CASE v_plan
      WHEN 'starter' THEN 15
      WHEN 'growth' THEN 50
      WHEN 'pro' THEN 150
      WHEN 'redbubble' THEN 30
      WHEN 'teepublic' THEN 30
      WHEN 'all_platforms' THEN 75
      ELSE 0
    END;
  END IF;

  IF v_daily_limit > 0 THEN
    INSERT INTO public.ai_usage (user_id, day_key, used_count)
    VALUES (p_user_id, v_day_key, 0)
    ON CONFLICT (user_id, day_key)
    DO UPDATE SET updated_at = public.ai_usage.updated_at
    RETURNING used_count INTO v_used_count;

    IF v_used_count < v_daily_limit THEN
      UPDATE public.ai_usage
         SET used_count = used_count + 1,
             updated_at = now()
       WHERE user_id = p_user_id
         AND day_key = v_day_key
         AND used_count < v_daily_limit
       RETURNING used_count INTO v_used_count;

      IF FOUND THEN
        token_source := 'daily';
        remaining_daily := greatest(v_daily_limit - v_used_count, 0);
        remaining_extra := greatest(coalesce(v_subscription.ai_tokens, 0), 0);
        RETURN NEXT;
        RETURN;
      END IF;
    END IF;
  END IF;

  IF coalesce(v_subscription.ai_tokens, 0) > 0 THEN
    UPDATE public.subscriptions
       SET ai_tokens = ai_tokens - 1,
           updated_at = now()
     WHERE id = v_subscription.id
       AND ai_tokens > 0
     RETURNING ai_tokens INTO v_remaining_extra;

    IF FOUND THEN
      token_source := 'extra';
      remaining_daily := 0;
      remaining_extra := greatest(v_remaining_extra, 0);
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_ai_token_atomic(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_ai_token_atomic(uuid) TO service_role;
