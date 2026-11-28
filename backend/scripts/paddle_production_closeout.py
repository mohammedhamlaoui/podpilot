"""Close the explicitly disposable UI canary; run as root on the approved VPS.

Never changes a paid transaction or an existing customer. Retains webhook audit rows.
"""
import hashlib
import hmac
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

UID = "9ca6e2fd-fc90-427a-8885-49446f364c7d"
RUN = "paddle-ui-2d134d88af0d4312a0bff69b1d9d8412"
EMAIL = RUN + "@example.com"
BACKUP = Path("/var/backups/podpilot/billing-20261127T233316Z")


def main():
    container = json.loads(subprocess.check_output(["docker", "inspect", "deploy-api-1"]))[0]
    env = dict(v.split("=", 1) for v in container["Config"]["Env"] if "=" in v)
    assert env["PADDLE_CHECKOUT_ENABLED"] == "false"
    assert not env.get("PADDLE_CANARY_USER_IDS")
    report = {"run": RUN, "no_payment_submitted": True, "checks": {}}

    def request(base, method, route, headers=None, payload=None, params=None):
        url = base.rstrip("/") + route
        if params:
            url += "?" + urllib.parse.urlencode(params)
        data = None if payload is None else json.dumps(payload).encode()
        h = {"Content-Type": "application/json", **(headers or {})}
        req = urllib.request.Request(url, data=data, headers=h, method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                raw = res.read()
                return res.status, json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            return error.code, None

    def db(method, route, payload=None, params=None):
        status, body = request(env["SUPABASE_URL"], method, route, {
            "apikey": env["SUPABASE_SERVICE_ROLE_KEY"],
            "Authorization": "Bearer " + env["SUPABASE_SERVICE_ROLE_KEY"],
            "Prefer": "return=representation",
        }, payload, params)
        assert 200 <= status < 300, ("Supabase request failed", method, route.split("?")[0], status)
        return body

    def paddle(method, route, payload=None, params=None):
        status, body = request("https://api.paddle.com", method, route,
            {"Authorization": "Bearer " + env["PADDLE_API_KEY"]}, payload, params)
        assert status == 200, ("Paddle request failed", method, status)
        return body

    user = db("GET", "/auth/v1/admin/users/" + UID)
    assert user["email"] == EMAIL and user["app_metadata"]["podpilot_billing_canary"] == RUN
    link = db("POST", "/auth/v1/admin/generate_link", {"type": "magiclink", "email": EMAIL})
    session = db("POST", "/auth/v1/verify", {"type": "magiclink", "token_hash": link["hashed_token"] if "hashed_token" in link else link["properties"]["hashed_token"]})
    assert session["user"]["id"] == UID
    status, _ = request("https://api.podpilot.space", "POST", "/api/billing/checkout",
        {"Authorization": "Bearer " + session["access_token"]}, {"plan_key": "redbubble", "billing_cycle": "monthly"})
    assert status == 503
    report["checks"]["general_checkout_gate"] = status

    for name, signature in [("missing", None), ("invalid", "ts=" + str(int(time.time())) + ";h1=" + "0" * 64),
                             ("expired", str(int(time.time()) - 600)), ("valid_missing_event", str(int(time.time())))]:
        body = b"{}"
        if name in ("expired", "valid_missing_event"):
            signature = "ts=" + signature + ";h1=" + hmac.new(env["PADDLE_WEBHOOK_SECRET"].encode(), signature.encode() + b":" + body, hashlib.sha256).hexdigest()
        status, _ = request("https://api.podpilot.space", "POST", "/api/paddle/webhook",
            {"Paddle-Signature": signature} if signature else {}, {})
        assert status == (400 if name == "valid_missing_event" else 401), (name, status)
        report["checks"]["signature_" + name] = status

    recent = paddle("GET", "/transactions", params={"per_page": 100, "order_by": "created_at[DESC]"})
    assert not recent.get("meta", {}).get("pagination", {}).get("has_more"), "Paginate before cleanup"
    transactions = [t for t in recent["data"] if (t.get("custom_data") or {}).get("user_id") == UID]
    customers = paddle("GET", "/customers", params={"email": EMAIL, "per_page": 100})["data"]
    assert len(customers) == 1 and customers[0]["email"] == EMAIL
    customer_id = customers[0]["id"]
    assert not paddle("GET", "/subscriptions", params={"customer_id": customer_id})["data"]
    assert transactions and all(t.get("customer_id") == customer_id and t["status"] in ("ready", "draft", "canceled") for t in transactions)
    intents = db("GET", "/rest/v1/paddle_checkout_intents", params={"user_id": "eq." + UID})
    credits = db("GET", "/rest/v1/paddle_token_credits", params={"user_id": "eq." + UID})
    assert not credits, "Unexpected paid credit fulfillment"
    evidence = {"run": RUN, "intents": intents, "transactions": transactions}
    evidence_path = BACKUP / "ui-canary-before-cleanup.json"
    evidence_path.write_text(json.dumps(evidence, indent=2))
    os.chmod(evidence_path, 0o600)
    for transaction in transactions:
        if transaction["status"] != "canceled":
            result = paddle("PATCH", "/transactions/" + transaction["id"], {"status": "canceled"})
            assert result["data"]["status"] == "canceled"
    assert paddle("PATCH", "/customers/" + customer_id, {"status": "archived"})["data"]["status"] == "archived"
    db("DELETE", "/rest/v1/paddle_checkout_intents", params={"user_id": "eq." + UID})
    db("DELETE", "/rest/v1/subscriptions", params={"user_id": "eq." + UID})
    db("DELETE", "/auth/v1/admin/users/" + UID)
    status, _ = request(env["SUPABASE_URL"], "GET", "/auth/v1/admin/users/" + UID,
        {"apikey": env["SUPABASE_SERVICE_ROLE_KEY"], "Authorization": "Bearer " + env["SUPABASE_SERVICE_ROLE_KEY"]})
    assert status == 404
    report["checks"].update({"unpaid_transactions_canceled": len(transactions), "canary_customer_archived": True, "canary_auth_deleted": True, "webhook_audit_retained": True})

    before = json.loads((BACKUP / "targeted-billing-before.json").read_text())["tables"]
    preserved = {}
    for table, originals in before.items():
        current = db("GET", "/rest/v1/" + table, params={"select": "*"})
        if originals:
            key = "id" if "id" in originals[0] else "event_id"
            by_id = {row[key]: row for row in current}
            missing = sum(row[key] not in by_id for row in originals)
            changed = sum(any(by_id[row[key]].get(k) != v for k, v in row.items()) for row in originals if row[key] in by_id)
        else:
            missing = changed = 0
        preserved[table] = {"original": len(originals), "current": len(current), "missing": missing, "changed": changed}
        assert missing == changed == 0, ("Original billing data changed", table)
    report["preservation"] = preserved
    report["passed"] = True
    target = BACKUP / "ui-closeout-report.json"
    target.write_text(json.dumps(report, indent=2)); os.chmod(target, 0o600)
    print(json.dumps(report))


if __name__ == "__main__":
    main()
