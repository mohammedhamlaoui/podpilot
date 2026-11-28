"""Explicit operator canary. Synthetic signed production webhooks, never purchases.

Requires PADDLE_ACCEPTANCE_APPROVED=1. Credentials come only from the server env.
Creates a dedicated test identity/customer and cleans only its own records on success.
Never creates a product, price, transaction, subscription, or actual refund in Paddle.
"""
import hashlib
import hmac
import json
import os
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

import httpx


def main():
    assert os.environ.get("PADDLE_ACCEPTANCE_APPROVED") == "1", "Explicit approval required"
    assert os.environ.get("PADDLE_CHECKOUT_ENABLED") == "false", "Checkout must stay disabled"
    run = os.environ.get("PADDLE_ACCEPTANCE_RUN") or "paddle-canary-" + uuid.uuid4().hex
    report = {"run": run, "checks": [], "kind": "production HTTP with synthetic fixtures; no paid checkout"}
    uid = None
    customer = None
    event_ids = []
    txns, adjustments = [], []
    base = datetime.now(timezone.utc) - timedelta(minutes=2)
    db_headers = {"apikey": os.environ["SUPABASE_SERVICE_ROLE_KEY"], "Authorization": "Bearer " + os.environ["SUPABASE_SERVICE_ROLE_KEY"]}
    db = httpx.Client(base_url=os.environ["SUPABASE_URL"], headers=db_headers, timeout=25)
    paddle = httpx.Client(base_url="https://api.paddle.com", headers={"Authorization": "Bearer " + os.environ["PADDLE_API_KEY"]}, timeout=25)
    api = httpx.Client(base_url="https://api.podpilot.space", timeout=25)

    def check(name, passed, **evidence):
        report["checks"].append({"check": name, "passed": bool(passed), **evidence})
        if not passed:
            raise AssertionError(name)

    def rest(method, table, *, params=None, payload=None):
        r = db.request(method, "/rest/v1/" + table, params=params, json=payload, headers={"Prefer": "return=representation"})
        r.raise_for_status()
        return r.json() if r.content else None

    def sub():
        rows = rest("GET", "subscriptions", params={"user_id": "eq." + uid, "select": "*"})
        assert len(rows) == 1
        return rows[0]

    def send(event_type, data, *, event=None, occurred=None, expected=200):
        eid = event or "evt_" + uuid.uuid4().hex[:26]
        if eid not in event_ids:
            event_ids.append(eid)
        envelope = {"event_id": eid, "notification_id": "ntf_" + uuid.uuid4().hex[:26], "event_type": event_type,
                    "occurred_at": occurred or (base + timedelta(seconds=len(event_ids))).isoformat(), "data": data}
        raw = json.dumps(envelope, separators=(",", ":")).encode()
        ts = str(int(time.time()))
        signature = hmac.new(os.environ["PADDLE_WEBHOOK_SECRET"].encode(), ts.encode() + b":" + raw, hashlib.sha256).hexdigest()
        r = api.post("/api/paddle/webhook", content=raw, headers={"Content-Type": "application/json", "Paddle-Signature": "ts=" + ts + ";h1=" + signature})
        check(event_type + ":HTTP", r.status_code == expected, actual_http=r.status_code, expected_http=expected, event_id=eid)
        return eid, r.json()

    try:
        email = run + "@example.com"
        password = secrets.token_urlsafe(40)
        resume_uid = os.environ.get("PADDLE_ACCEPTANCE_USER_ID")
        resume_customer = os.environ.get("PADDLE_ACCEPTANCE_CUSTOMER_ID")
        if resume_uid:
            assert resume_customer and os.environ.get("PADDLE_ACCEPTANCE_RUN")
            owner = db.get("/auth/v1/admin/users/" + resume_uid)
            owner.raise_for_status()
            assert owner.json()["app_metadata"]["podpilot_billing_canary"] == run
            r = db.put("/auth/v1/admin/users/" + resume_uid, json={"password": password})
        else:
            r = db.post("/auth/v1/admin/users", json={"email": email, "password": password, "email_confirm": True,
                    "app_metadata": {"podpilot_billing_canary": run}, "user_metadata": {"test_account": True}})
        r.raise_for_status()
        uid = r.json()["id"]
        report["canary_user_id"] = uid
        if resume_customer:
            r = paddle.get("/customers/" + resume_customer)
            r.raise_for_status()
            assert r.json()["data"]["custom_data"]["podpilot_canary"] == run
        else:
            r = paddle.post("/customers", json={"email": email, "name": "PodPilot isolated billing canary", "custom_data": {"podpilot_canary": run}})
        check("Paddle test customer available without transaction", r.status_code in (200, 201), http=r.status_code)
        customer = r.json()["data"]["id"]
        report["canary_customer_id"] = customer
        rows = rest("GET", "subscriptions", params={"user_id": "eq." + uid, "select": "id"})
        fixture = {"user_id": uid, "plan": "starter", "status": "inactive", "ai_tokens": 77, "paddle_customer_id": customer}
        if rows:
            assert len(rows) == 1
            rest("PATCH", "subscriptions", params={"id": "eq." + rows[0]["id"], "user_id": "eq." + uid}, payload=fixture)
        else:
            rest("POST", "subscriptions", payload=fixture)
        r = db.post("/auth/v1/token", params={"grant_type": "password"}, json={"email": email, "password": password})
        r.raise_for_status()
        user_headers = {"Authorization": "Bearer " + r.json()["access_token"]}
        r = api.post("/api/billing/checkout", json={"plan_key": "redbubble"}, headers=user_headers)
        check("general customer checkout remains disabled", r.status_code == 503, http=r.status_code)
        r = api.post("/api/billing/customer-portal", headers=user_headers)
        check("owned customer portal", r.status_code == 200, http=r.status_code)
        portal = r.json()["url"]
        parsed = urlsplit(portal)
        check("portal URL belongs to Paddle HTTPS", parsed.scheme == "https" and (parsed.hostname or "").endswith(".paddle.com"))
        r = httpx.get(portal, timeout=25, follow_redirects=False)
        check("portal HTTPS loads without a purchase", r.status_code in (200, 301, 302, 303, 307, 308), http=r.status_code)
        monthly = os.environ["PADDLE_REDBUBBLE_MONTHLY_PRICE_ID"]
        credit_price = os.environ["PADDLE_AI_TOKENS_1000_PRICE_ID"]
        subscription_intent, credit_intent = str(uuid.uuid4()), str(uuid.uuid4())
        for intent_id, kind, price in [(subscription_intent, "subscription", monthly), (credit_intent, "ai_credits", credit_price)]:
            rest("POST", "paddle_checkout_intents", payload={"id": intent_id, "user_id": uid, "intent_type": kind,
                 "selected_price_id": price, "plan_key": "redbubble" if kind == "subscription" else None,
                 "billing_interval": "monthly" if kind == "subscription" else None,
                 "credit_pack_id": "tokens_1000" if kind == "ai_credits" else None,
                 "status": "opened", "idempotency_key": run + intent_id})
        subscription = {"id": "sub_" + uuid.uuid4().hex[:26], "customer_id": customer, "status": "active",
                        "items": [{"price": {"id": monthly}, "quantity": 1}],
                        "custom_data": {"user_id": uid, "checkout_intent_id": subscription_intent, "podpilot_canary": run},
                        "current_billing_period": {"starts_at": base.isoformat(), "ends_at": (base + timedelta(days=30)).isoformat()}}
        first, _ = send("subscription.created", subscription)
        check("subscription activated; existing test credits preserved", sub()["status"] == "active" and sub()["ai_tokens"] == 77)
        _, duplicate = send("subscription.created", subscription, event=first)
        check("duplicate event acknowledged without fulfillment", duplicate.get("duplicate") is True)
        renewed = {**subscription, "current_billing_period": {"starts_at": (base + timedelta(days=30)).isoformat(), "ends_at": (base + timedelta(days=60)).isoformat()}}
        send("subscription.updated", renewed)
        check("renewal updates period and preserves credits", sub()["current_period_ends_at"].startswith((base + timedelta(days=60)).strftime("%Y-%m-%d")) and sub()["ai_tokens"] == 77)
        for state in ("past_due", "active", "paused", "active"):
            send("subscription.updated", {**renewed, "status": state})
            check("lifecycle:" + state, sub()["status"] == state)
        send("subscription.updated", {**subscription, "custom_data": {"user_id": str(uuid.uuid4())}}, expected=422)
        check("cross-user event cannot change ownership", sub()["user_id"] == uid and sub()["status"] == "active")
        transaction = {"id": "txn_" + uuid.uuid4().hex[:26], "customer_id": customer, "status": "completed", "currency_code": "USD",
                       "items": [{"price": {"id": credit_price}, "quantity": 1}],
                       "custom_data": {"user_id": uid, "checkout_intent_id": credit_intent, "podpilot_canary": run},
                       "details": {"totals": {"total": "499", "grand_total": "499", "tax": "0"}}}
        txns.append(transaction["id"])
        credit_event, _ = send("transaction.completed", transaction)
        check("one thousand credits granted atomically", sub()["ai_tokens"] == 1077)
        send("transaction.completed", transaction, event=credit_event)
        send("transaction.completed", transaction)
        ledger = rest("GET", "paddle_token_credits", params={"transaction_id": "eq." + transaction["id"]})
        check("same transaction across deliveries grants only once", sub()["ai_tokens"] == 1077 and len(ledger) == 1 and ledger[0]["status"] == "credited")
        adjustment = {"id": "adj_" + uuid.uuid4().hex[:26], "transaction_id": transaction["id"], "action": "refund", "type": "partial",
                      "status": "pending_approval", "currency_code": "USD", "totals": {"total": "100"}}
        adjustments.append(adjustment["id"])
        send("adjustment.created", adjustment)
        check("unapproved refund does not revoke credits", sub()["ai_tokens"] == 1077)
        send("adjustment.updated", {**adjustment, "status": "approved"})
        check("partial refund revokes proportional credits", sub()["ai_tokens"] == 876)
        full = {**adjustment, "id": "adj_" + uuid.uuid4().hex[:26], "status": "approved", "type": "full", "totals": {"total": "499"}}
        adjustments.append(full["id"])
        refund_event, _ = send("adjustment.updated", full)
        send("adjustment.updated", full, event=refund_event)
        send("adjustment.updated", full)
        check("full refund and duplicate refund preserve prior credits", sub()["ai_tokens"] == 77)
        send("subscription.canceled", {**renewed, "status": "canceled"})
        send("subscription.updated", subscription, occurred=base.isoformat())
        check("cancellation cannot be undone by an older event", sub()["status"] == "canceled" and sub()["ai_tokens"] == 77)

        # Only the freshly created and explicitly marked canary can be cleaned up.
        owner = db.get("/auth/v1/admin/users/" + uid)
        owner.raise_for_status()
        assert owner.json()["app_metadata"]["podpilot_billing_canary"] == run
        for txn in txns:
            for table in ("billing_adjustments", "billing_transactions"):
                r = db.delete("/rest/v1/" + table, params={"paddle_transaction_id": "eq." + txn})
                assert r.status_code in (200, 204, 404)
            rest("DELETE", "paddle_credit_adjustments", params={"transaction_id": "eq." + txn})
        for target in txns + adjustments:
            r = db.delete("/rest/v1/admin_notifications", params={"target_id": "eq." + target})
            assert r.status_code in (200, 204, 404)
        rest("DELETE", "paddle_token_credits", params={"user_id": "eq." + uid})
        rest("DELETE", "paddle_checkout_intents", params={"user_id": "eq." + uid})
        rest("DELETE", "subscriptions", params={"user_id": "eq." + uid})
        for eid in event_ids:
            rest("DELETE", "paddle_webhook_events", params={"event_id": "eq." + eid})
        r = db.delete("/auth/v1/admin/users/" + uid)
        r.raise_for_status()
        r = paddle.patch("/customers/" + customer, json={"status": "archived"})
        r.raise_for_status()
        check("isolated canary records cleaned; Paddle test customer archived", True)
        report["passed"] = True
    except Exception as error:
        report["passed"] = False
        report["error_type"] = type(error).__name__
        report["stopped_on_failure"] = True
        report["fixtures_retained_for_diagnosis"] = True
    finally:
        db.close(); paddle.close(); api.close()
        print(json.dumps(report))
    return 0 if report.get("passed") else 1


if __name__ == "__main__":
    raise SystemExit(main())
