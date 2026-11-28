-- Retain existing NOT NULL plan constraint. Only replaces the new fulfillment function.
BEGIN;
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

COMMIT;
