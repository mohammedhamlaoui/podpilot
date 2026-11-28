"""Isolated LIVE resolver and synthetic webhook canary. Never makes Paddle payments.

Runs as a separate Python process; its canary override never changes the running API.
All durable test records are scoped to a newly created and marked Supabase identity.
"""
import hashlib
import hmac
import json
import os
import secrets
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import httpx
from starlette.requests import Request
from app.api import billing
from app.core.auth import AuthUser


def main():
    assert os.environ.get("PADDLE_ACCEPTANCE_APPROVED") == "1"
    assert os.environ.get("PADDLE_CHECKOUT_ENABLED") == "false"
    run = os.environ.get("PADDLE_ACCEPTANCE_RUN") or "paddle-extended-" + uuid.uuid4().hex
    report = {"run": run, "checks": [], "kind": "production resolver and HTTP with isolated synthetic fixtures; no paid checkout"}
    event_ids, transactions, adjustments = [], [], []
    user_id = None
    base = datetime.now(timezone.utc) - timedelta(minutes=2)
    db = httpx.Client(base_url=os.environ["SUPABASE_URL"], headers={"apikey": os.environ["SUPABASE_SERVICE_ROLE_KEY"],
                           "Authorization": "Bearer " + os.environ["SUPABASE_SERVICE_ROLE_KEY"]}, timeout=30)
    api = httpx.Client(base_url="https://api.podpilot.space", timeout=45)

    def check(name, passed, **evidence):
        report["checks"].append({"check": name, "passed": bool(passed), **evidence})
        if not passed:
            raise AssertionError(name)

    def rest(method, table, params=None, payload=None):
        r = db.request(method, "/rest/v1/" + table, params=params, json=payload, headers={"Prefer": "return=representation"})
        r.raise_for_status()
        return r.json() if r.content else None

    def current():
        rows = rest("GET", "subscriptions", {"user_id": "eq." + user_id, "select": "*"})
        assert len(rows) == 1
        return rows[0]

    def event(kind, data, eid=None, occurred=None):
        eid = eid or "evt_" + uuid.uuid4().hex[:26]
        event_ids.append(eid)
        body = json.dumps({"event_id": eid, "event_type": kind, "notification_id": "ntf_" + uuid.uuid4().hex[:26],
                  "occurred_at": occurred or datetime.now(timezone.utc).isoformat(), "data": data}, separators=(",", ":")).encode()
        ts = str(int(time.time()))
        sig = hmac.new(os.environ["PADDLE_WEBHOOK_SECRET"].encode(), ts.encode()+b":"+body, hashlib.sha256).hexdigest()
        response = api.post("/api/paddle/webhook", content=body, headers={"Content-Type":"application/json", "Paddle-Signature":"ts="+ts+";h1="+sig})
        return response.status_code

    try:
        email = run + "@example.com"
        resume_user = os.environ.get("PADDLE_ACCEPTANCE_USER_ID")
        if resume_user:
            assert os.environ.get("PADDLE_ACCEPTANCE_RUN")
            r = db.get("/auth/v1/admin/users/"+resume_user)
            r.raise_for_status()
            assert r.json()["app_metadata"]["podpilot_billing_canary"]==run
        else:
            r = db.post("/auth/v1/admin/users", json={"email":email,"password":secrets.token_urlsafe(40),"email_confirm":True,
                          "app_metadata":{"podpilot_billing_canary":run}})
        r.raise_for_status(); user_id = r.json()["id"]
        report["canary_user_id"] = user_id
        check("fresh buyer has no subscription row", not rest("GET","subscriptions",{"user_id":"eq."+user_id,"select":"id"}))
        # Only this short-lived process permits the new canary to call the resolver.
        billing.config.PADDLE_CANARY_USER_IDS.add(user_id)
        user = AuthUser(user_id,email,"synthetic-server-canary")
        request = Request({"type":"http","method":"POST","path":"/api/billing/checkout","headers":[],"client":("127.0.0.1",0)})
        resolved = {}
        for plan in ("redbubble","teepublic"):
            for cycle in ("monthly","annual"):
                result = billing.get_checkout_price_id(billing.CheckoutRequest(plan_key=plan,billing_cycle=cycle),request,user,None)
                expected = getattr(billing.config,"PADDLE_"+plan.upper()+"_"+cycle.upper()+"_PRICE_ID")
                check("LIVE resolver:"+plan+":"+cycle,result["selected_price_id"]==expected and bool(result["checkout_intent_id"]))
                resolved[(plan,cycle)] = result
        for pack in ("tokens_1000","tokens_10000"):
            result = billing.get_checkout_price_id(billing.CheckoutRequest(intent_type="ai_credits",credit_pack_id=pack),request,user,None)
            check("LIVE credit resolver:"+pack,result["selected_price_id"]==getattr(billing.config,"PADDLE_AI_"+pack.upper()+"_PRICE_ID"))
            resolved[pack] = result
        credit = resolved["tokens_10000"]
        txn = "txn_"+uuid.uuid4().hex[:26]; transactions.append(txn)
        data = {"id":txn,"status":"completed","currency_code":"USD","items":[{"price":{"id":credit["selected_price_id"]},"quantity":1}],
                "custom_data":{"user_id":user_id,"checkout_intent_id":credit["checkout_intent_id"],"podpilot_canary":run},
                "details":{"totals":{"total":"3999","grand_total":"3999","tax":"0"}}}
        with ThreadPoolExecutor(max_workers=8) as workers:
            statuses = list(workers.map(lambda _: event("transaction.completed",data), range(20)))
        check("twenty concurrent production deliveries return 200", statuses==[200]*20, http_counts={str(code):statuses.count(code) for code in set(statuses)})
        ledger = rest("GET","paddle_token_credits",{"transaction_id":"eq."+txn})
        row = current()
        check("new 10000-credit buyer is credited once without active plan",row["ai_tokens"]==10000 and row["status"]=="inactive" and row["plan"]=="starter" and len(ledger)==1)
        annual = resolved[("teepublic","annual")]
        subscription = {"id":"sub_"+uuid.uuid4().hex[:26],"customer_id":"ctm_"+uuid.uuid4().hex[:26],"status":"active",
                        "items":[{"price":{"id":annual["selected_price_id"]},"quantity":1}],
                        "custom_data":{"user_id":user_id,"checkout_intent_id":annual["checkout_intent_id"],"podpilot_canary":run},
                        "current_billing_period":{"starts_at":base.isoformat(),"ends_at":(base+timedelta(days=365)).isoformat()}}
        check("annual subscription webhook",event("subscription.created",subscription)==200)
        row = current()
        check("annual metadata and credits persisted",row["plan"]=="teepublic" and row["billing_cycle"]=="annual" and row["ai_tokens"]==10000)
        monthly = {**subscription,"items":[{"price":{"id":resolved[("redbubble","monthly")]["selected_price_id"]},"quantity":1}]}
        check("bound subscription accepts changed mapped price",event("subscription.updated",monthly)==200)
        check("monthly metadata persisted without resetting credits",current()["billing_cycle"]=="monthly" and current()["plan"]=="redbubble" and current()["ai_tokens"]==10000)
        failed = "txn_"+uuid.uuid4().hex[:26]; transactions.append(failed)
        failure = {"id":failed,"subscription_id":subscription["id"],"customer_id":subscription["customer_id"],"status":"past_due","currency_code":"USD",
                   "details":{"totals":{"total":"0","grand_total":"0","tax":"0"}}}
        check("payment failure notification",event("transaction.payment_failed",failure)==200)
        check("failed attempt does not prematurely revoke active access",current()["status"]=="active")
        check("past due lifecycle notification",event("subscription.past_due",{**monthly,"status":"past_due"})==200)
        check("past due status persisted",current()["status"]=="past_due")
        adjustment = "adj_"+uuid.uuid4().hex[:26]; adjustments.append(adjustment)
        refund = {"id":adjustment,"transaction_id":txn,"status":"approved","action":"refund","type":"full","currency_code":"USD","totals":{"total":"3999"}}
        check("10000-credit refund",event("adjustment.updated",refund)==200)
        check("refund counter and balance reconcile",current()["ai_tokens"]==0 and rest("GET","paddle_token_credits",{"transaction_id":"eq."+txn})[0]["revoked_tokens"]==10000)
        owner = db.get("/auth/v1/admin/users/"+user_id);owner.raise_for_status()
        assert owner.json()["app_metadata"]["podpilot_billing_canary"]==run
        for transaction in transactions:
            for table in ("billing_adjustments","billing_transactions"):
                response=db.delete("/rest/v1/"+table,params={"paddle_transaction_id":"eq."+transaction})
                assert response.status_code in (200,204,404)
            rest("DELETE","paddle_credit_adjustments",{"transaction_id":"eq."+transaction})
        for target in transactions+adjustments:
            response=db.delete("/rest/v1/admin_notifications",params={"target_id":"eq."+target})
            assert response.status_code in (200,204,404)
        for table in ("paddle_token_credits","paddle_checkout_intents","subscriptions"):
            rest("DELETE",table,{"user_id":"eq."+user_id})
        for eid in event_ids:
            rest("DELETE","paddle_webhook_events",{"event_id":"eq."+eid})
        response=db.delete("/auth/v1/admin/users/"+user_id);response.raise_for_status()
        check("only marked canary records cleaned",True)
        report["passed"]=True
    except Exception as error:
        report["passed"]=False
        report["error_type"]=type(error).__name__
        report["fixtures_retained_for_diagnosis"]=True
    finally:
        db.close();api.close()
        print(json.dumps(report))
    return 0 if report.get("passed") else 1


if __name__=="__main__":raise SystemExit(main())
