-- Preflight required: existing Paddle ledgers, checkout intents, subscriptions, ai_tokens.
-- Additive; never resets balances or removes customer data. Apply as a single transaction.
BEGIN;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS paddle_event_at timestamptz;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS paddle_event_id text;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS billing_cycle text CHECK (billing_cycle IN ('monthly','annual'));
ALTER TABLE public.paddle_token_credits ADD COLUMN IF NOT EXISTS revoked_tokens integer NOT NULL DEFAULT 0;
ALTER TABLE public.paddle_token_credits ADD COLUMN IF NOT EXISTS amount_minor bigint;
CREATE TABLE IF NOT EXISTS public.paddle_credit_adjustments (
  adjustment_id text PRIMARY KEY, transaction_id text NOT NULL,
  amount_minor bigint NOT NULL CHECK(amount_minor >= 0), full_refund boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.paddle_credit_adjustments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paddle_credit_adjustments FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.paddle_credit_adjustments TO service_role;

CREATE OR REPLACE FUNCTION public.paddle_claim_event(p_id text, p_type text, p_notification text, p_transaction text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE e public.paddle_webhook_events;
BEGIN
 INSERT INTO public.paddle_webhook_events(event_id,event_type,notification_id,transaction_id,status)
 VALUES(p_id,p_type,p_notification,p_transaction,'processing') ON CONFLICT DO NOTHING RETURNING * INTO e;
 IF FOUND THEN RETURN 'claimed'; END IF;
 SELECT * INTO STRICT e FROM public.paddle_webhook_events WHERE event_id=p_id FOR UPDATE;
 IF e.event_type <> p_type THEN RAISE EXCEPTION 'Paddle event type mismatch'; END IF;
 IF e.status IN ('processed','ignored') THEN RETURN 'done'; END IF;
 IF e.status='processing' AND e.updated_at > now()-interval '10 minutes' THEN RETURN 'busy'; END IF;
 UPDATE public.paddle_webhook_events SET status='processing',attempts=attempts+1,updated_at=now(),last_error=NULL WHERE event_id=p_id;
 RETURN 'claimed';
END $$;

CREATE OR REPLACE FUNCTION public.paddle_apply_subscription(p_payload jsonb, p_event_id text, p_occurred_at timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s public.subscriptions; n public.subscriptions; u uuid := (p_payload->>'user_id')::uuid;
BEGIN
 IF u IS NULL OR p_payload->>'paddle_subscription_id' IS NULL OR p_occurred_at IS NULL THEN RAISE EXCEPTION 'Missing Paddle identity'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('paddle-user:'||u::text,0));
 SELECT * INTO s FROM public.subscriptions WHERE paddle_subscription_id=p_payload->>'paddle_subscription_id' FOR UPDATE;
 IF FOUND AND s.user_id<>u THEN RAISE EXCEPTION 'Paddle owner mismatch'; END IF;
 IF s.paddle_event_at IS NOT NULL AND s.paddle_event_at >= p_occurred_at THEN RETURN false; END IF;
 IF s.id IS NULL THEN
   SELECT * INTO s FROM public.subscriptions WHERE user_id=u AND paddle_subscription_id IS NULL
   ORDER BY updated_at DESC,created_at DESC LIMIT 1 FOR UPDATE;
 END IF;
 n := jsonb_populate_record(s,p_payload);
 IF s.id IS NULL THEN
   INSERT INTO public.subscriptions(user_id,plan,status,paddle_customer_id,paddle_subscription_id,paddle_price_id,
     current_period_starts_at,current_period_ends_at,cancel_at_period_end,billing_anchor,billing_cycle,
     trial_starts_at,trial_ends_at,paddle_event_at,paddle_event_id,updated_at)
   VALUES(u,n.plan,n.status,n.paddle_customer_id,n.paddle_subscription_id,n.paddle_price_id,
     n.current_period_starts_at,n.current_period_ends_at,coalesce(n.cancel_at_period_end,false),n.billing_anchor,n.billing_cycle,
     n.trial_starts_at,n.trial_ends_at,p_occurred_at,p_event_id,p_occurred_at);
 ELSE
   UPDATE public.subscriptions SET plan=n.plan,status=n.status,paddle_customer_id=n.paddle_customer_id,
     paddle_subscription_id=n.paddle_subscription_id,paddle_price_id=n.paddle_price_id,
     current_period_starts_at=n.current_period_starts_at,current_period_ends_at=n.current_period_ends_at,
     cancel_at_period_end=n.cancel_at_period_end,billing_anchor=n.billing_anchor,billing_cycle=n.billing_cycle,
     trial_starts_at=n.trial_starts_at,trial_ends_at=n.trial_ends_at,paddle_event_at=p_occurred_at,
     paddle_event_id=p_event_id,updated_at=p_occurred_at WHERE id=s.id;
 END IF;
 RETURN true;
END $$;

-- Reconcile approved credit refunds, including refunds arriving before fulfillment.
CREATE OR REPLACE FUNCTION public.paddle_reconcile_credit_refunds(p_transaction text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.paddle_token_credits; s public.subscriptions; target integer; delta integer;
BEGIN
 SELECT * INTO c FROM public.paddle_token_credits WHERE transaction_id=p_transaction;
 IF NOT FOUND OR c.status<>'credited' THEN RETURN 0; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('paddle-user:'||c.user_id::text,0));
 SELECT * INTO c FROM public.paddle_token_credits WHERE transaction_id=p_transaction FOR UPDATE;
 SELECT * INTO s FROM public.subscriptions WHERE user_id=c.user_id
 ORDER BY (paddle_subscription_id IS NOT NULL) DESC,updated_at DESC,created_at DESC LIMIT 1 FOR UPDATE;
 SELECT CASE WHEN bool_or(full_refund) THEN c.tokens
   WHEN c.amount_minor>0 THEN least(c.tokens,ceil(c.tokens::numeric*coalesce(sum(amount_minor),0)/c.amount_minor)::integer)
   ELSE 0 END INTO target FROM public.paddle_credit_adjustments WHERE transaction_id=p_transaction;
 target := coalesce(target,0); delta := greatest(0,target-c.revoked_tokens);
 IF delta>0 THEN
   UPDATE public.subscriptions SET ai_tokens=greatest(0,coalesce(ai_tokens,0)-delta) WHERE id=s.id;
   UPDATE public.paddle_token_credits SET revoked_tokens=target,updated_at=now() WHERE transaction_id=p_transaction;
 END IF;
 RETURN delta;
END $$;

CREATE OR REPLACE FUNCTION public.paddle_credit_purchase(p_transaction text,p_event text,p_user uuid,p_tokens integer,p_intent uuid,p_price text,p_amount bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.paddle_token_credits; i public.paddle_checkout_intents; s public.subscriptions;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('paddle-transaction:'||p_transaction,0));
 IF p_tokens<=0 OR p_amount<=0 THEN RAISE EXCEPTION 'Invalid Paddle credit quantity'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('paddle-user:'||p_user::text,0));
 SELECT * INTO STRICT i FROM public.paddle_checkout_intents WHERE id=p_intent FOR UPDATE;
 IF i.user_id<>p_user OR i.intent_type<>'ai_credits' OR i.selected_price_id<>p_price THEN RAISE EXCEPTION 'Paddle intent mismatch'; END IF;
 SELECT * INTO c FROM public.paddle_token_credits WHERE transaction_id=p_transaction FOR UPDATE;
 IF FOUND AND (c.user_id<>p_user OR c.tokens<>p_tokens) THEN RAISE EXCEPTION 'Paddle transaction mismatch'; END IF;
 IF FOUND AND c.status='credited' THEN RETURN false; END IF;
 IF FOUND THEN RAISE EXCEPTION 'Legacy incomplete Paddle credit requires manual reconciliation'; END IF;
 -- A paid intent may only replay its original transaction, never fund a second one.
 IF i.status='paid' AND i.paddle_transaction_id IS DISTINCT FROM p_transaction THEN RAISE EXCEPTION 'Paddle intent already consumed'; END IF;
 SELECT * INTO s FROM public.subscriptions WHERE user_id=p_user
 ORDER BY (paddle_subscription_id IS NOT NULL) DESC,updated_at DESC,created_at DESC LIMIT 1 FOR UPDATE;
 IF s.id IS NULL THEN
   -- Keep the production NOT NULL plan constraint; inactive never grants plan access.
   INSERT INTO public.subscriptions(user_id,plan,status,ai_tokens) VALUES(p_user,'starter','inactive',p_tokens) RETURNING * INTO s;
 ELSE
   UPDATE public.subscriptions SET ai_tokens=coalesce(ai_tokens,0)+p_tokens WHERE id=s.id;
 END IF;
 INSERT INTO public.paddle_token_credits(transaction_id,event_id,user_id,tokens,status,credited_at,amount_minor)
 VALUES(p_transaction,p_event,p_user,p_tokens,'credited',now(),p_amount)
 ON CONFLICT(transaction_id) DO UPDATE SET status='credited',credited_at=now(),updated_at=now(),amount_minor=p_amount,last_error=NULL;
 UPDATE public.paddle_checkout_intents SET status='paid',paddle_transaction_id=p_transaction,updated_at=now() WHERE id=p_intent;
 PERFORM public.paddle_reconcile_credit_refunds(p_transaction);
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.paddle_record_credit_refund(p_adjustment text,p_transaction text,p_amount bigint,p_full boolean)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.paddle_token_credits;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('paddle-transaction:'||p_transaction,0));
 SELECT * INTO c FROM public.paddle_token_credits WHERE transaction_id=p_transaction;
 IF FOUND THEN PERFORM pg_advisory_xact_lock(hashtextextended('paddle-user:'||c.user_id::text,0)); END IF;
 INSERT INTO public.paddle_credit_adjustments(adjustment_id,transaction_id,amount_minor,full_refund)
 VALUES(p_adjustment,p_transaction,greatest(0,p_amount),p_full) ON CONFLICT DO NOTHING;
 RETURN public.paddle_reconcile_credit_refunds(p_transaction);
END $$;

REVOKE ALL ON FUNCTION public.paddle_claim_event(text,text,text,text),public.paddle_apply_subscription(jsonb,text,timestamptz),
 public.paddle_credit_purchase(text,text,uuid,integer,uuid,text,bigint),public.paddle_record_credit_refund(text,text,bigint,boolean),
 public.paddle_reconcile_credit_refunds(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.paddle_claim_event(text,text,text,text),public.paddle_apply_subscription(jsonb,text,timestamptz),
 public.paddle_credit_purchase(text,text,uuid,integer,uuid,text,bigint),public.paddle_record_credit_refund(text,text,bigint,boolean),
 public.paddle_reconcile_credit_refunds(text) TO service_role;
REVOKE ALL ON public.paddle_webhook_events,public.paddle_token_credits FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.paddle_webhook_events,public.paddle_token_credits TO service_role;
COMMIT;
