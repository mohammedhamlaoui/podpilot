"""Verify the mapped bundle and authenticated entitlements without Paddle payments."""
import hashlib
import hmac
import json
import os
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
import httpx
from starlette.requests import Request
from app.api import billing
from app.core.auth import AuthUser


def main():
    assert os.environ.get("PADDLE_ACCEPTANCE_APPROVED")=="1"
    assert os.environ.get("PADDLE_CHECKOUT_ENABLED")=="false"
    report={"run":"paddle-bundle-"+uuid.uuid4().hex,"checks":[],"kind":"production bundle resolver and authenticated entitlement HTTP; synthetic subscription"}
    run=report["run"];uid=None;events=[]
    db=httpx.Client(base_url=os.environ["SUPABASE_URL"],headers={"apikey":os.environ["SUPABASE_SERVICE_ROLE_KEY"],"Authorization":"Bearer "+os.environ["SUPABASE_SERVICE_ROLE_KEY"]},timeout=30)
    api=httpx.Client(base_url="https://api.podpilot.space",timeout=30)
    def check(name,ok,**proof):
        report["checks"].append({"check":name,"passed":bool(ok),**proof})
        if not ok:raise AssertionError(name)
    def rest(method,table,params=None,payload=None):
        r=db.request(method,"/rest/v1/"+table,params=params,json=payload,headers={"Prefer":"return=representation"});r.raise_for_status();return r.json() if r.content else None
    def send(kind,data):
        eid="evt_"+uuid.uuid4().hex[:26];events.append(eid)
        body=json.dumps({"event_id":eid,"event_type":kind,"data":data,"occurred_at":datetime.now(timezone.utc).isoformat()},separators=(",",":")).encode()
        ts=str(int(time.time()));sig=hmac.new(os.environ["PADDLE_WEBHOOK_SECRET"].encode(),ts.encode()+b":"+body,hashlib.sha256).hexdigest()
        r=api.post("/api/paddle/webhook",content=body,headers={"Paddle-Signature":"ts="+ts+";h1="+sig,"Content-Type":"application/json"})
        check(kind+":HTTP",r.status_code==200,http=r.status_code)
    try:
        email=run+"@example.com";password=secrets.token_urlsafe(40)
        r=db.post("/auth/v1/admin/users",json={"email":email,"password":password,"email_confirm":True,"app_metadata":{"podpilot_billing_canary":run}});r.raise_for_status();uid=r.json()["id"]
        report["canary_user_id"]=uid
        r=db.post("/auth/v1/token",params={"grant_type":"password"},json={"email":email,"password":password});r.raise_for_status()
        headers={"Authorization":"Bearer "+r.json()["access_token"]}
        r=api.get("/api/me/platform-access",headers=headers);r.raise_for_status();d=r.json()
        check("inactive user cannot access either platform",not d["redbubble"] and not d["teepublic"])
        billing.config.PADDLE_CANARY_USER_IDS.add(uid)  # This process only; live API stays disabled.
        user=AuthUser(uid,email,"synthetic-server-canary")
        request=Request({"type":"http","method":"POST","path":"/api/billing/checkout","headers":[],"client":("127.0.0.1",0)})
        resolved={}
        for cycle in ("monthly","annual"):
            result=billing.get_checkout_price_id(billing.CheckoutRequest(plan_key="all_platforms",billing_cycle=cycle),request,user,None)
            check("LIVE bundle "+cycle+" price resolution",result["selected_price_id"]==os.environ["PADDLE_ALL_PLATFORMS_"+cycle.upper()+"_PRICE_ID"])
            resolved[cycle]=result
        now=datetime.now(timezone.utc)
        subscription={"id":"sub_"+uuid.uuid4().hex[:26],"customer_id":"ctm_"+uuid.uuid4().hex[:26],"status":"active",
                      "items":[{"price":{"id":resolved["monthly"]["selected_price_id"]},"quantity":1}],
                      "custom_data":{"user_id":uid,"checkout_intent_id":resolved["monthly"]["checkout_intent_id"],"podpilot_canary":run},
                      "current_billing_period":{"starts_at":now.isoformat(),"ends_at":(now+timedelta(days=30)).isoformat()}}
        send("subscription.created",subscription)
        row=rest("GET","subscriptions",{"user_id":"eq."+uid})[0]
        check("monthly bundle metadata persisted",row["plan"]=="all_platforms" and row["billing_cycle"]=="monthly" and row["status"]=="active")
        r=api.get("/api/me/platform-access",headers=headers);r.raise_for_status();d=r.json()
        check("authenticated monthly bundle unlocks both platforms",d["redbubble"] and d["teepublic"] and d["has_active_plan"])
        annual={**subscription,"items":[{"price":{"id":resolved["annual"]["selected_price_id"]},"quantity":1}],
                "current_billing_period":{"starts_at":now.isoformat(),"ends_at":(now+timedelta(days=365)).isoformat()}}
        send("subscription.updated",annual)
        row=rest("GET","subscriptions",{"user_id":"eq."+uid})[0]
        check("annual bundle metadata persisted",row["billing_cycle"]=="annual" and row["paddle_price_id"]==resolved["annual"]["selected_price_id"])
        r=api.get("/api/me/subscription",headers=headers);r.raise_for_status();d=r.json()
        check("authenticated subscription summary sees active bundle",d["plan"]=="all_platforms" and d["status"]=="active")
        scheduled={**annual,"scheduled_change":{"action":"cancel","effective_at":annual["current_billing_period"]["ends_at"]}}
        send("subscription.updated",scheduled)
        row=rest("GET","subscriptions",{"user_id":"eq."+uid})[0]
        r=api.get("/api/me/platform-access",headers=headers);r.raise_for_status();d=r.json()
        check("scheduled cancellation keeps access until period end",row["cancel_at_period_end"] and d["redbubble"] and d["teepublic"])
        send("subscription.canceled",{**annual,"status":"canceled"})
        r=api.get("/api/me/platform-access",headers=headers);r.raise_for_status();d=r.json()
        check("completed cancellation locks both platforms",not d["redbubble"] and not d["teepublic"] and not d["has_active_plan"])
        r=api.post("/api/billing/checkout",headers=headers,json={"plan_key":"all_platforms"})
        check("general customer bundle checkout still disabled",r.status_code==503,http=r.status_code)
        owner=db.get("/auth/v1/admin/users/"+uid);owner.raise_for_status();assert owner.json()["app_metadata"]["podpilot_billing_canary"]==run
        rest("DELETE","paddle_checkout_intents",{"user_id":"eq."+uid});rest("DELETE","subscriptions",{"user_id":"eq."+uid})
        for eid in events:rest("DELETE","paddle_webhook_events",{"event_id":"eq."+eid})
        r=db.delete("/auth/v1/admin/users/"+uid);r.raise_for_status()
        check("bundle canary records cleaned",True);report["passed"]=True
    except Exception as error:
        report["passed"]=False;report["error_type"]=type(error).__name__;report["fixtures_retained_for_diagnosis"]=True
    finally:
        db.close();api.close();print(json.dumps(report))
    return 0 if report.get("passed") else 1


if __name__=="__main__":raise SystemExit(main())
