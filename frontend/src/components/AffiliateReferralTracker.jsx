import { useEffect, useRef } from "react";
import { useAuth } from "../auth/AuthContext";
import {
  attributeAffiliateReferral,
  trackAffiliateClick,
  validateAffiliateCode,
} from "../api/client";
import {
  clearAffiliateAttribution,
  getAffiliateVisitorId,
  readAffiliateAttribution,
  storeAffiliateAttribution,
} from "../lib/affiliateAttribution";

export default function AffiliateReferralTracker() {
  const { user, loading } = useAuth();
  const attributedUserRef = useRef("");

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("ref")?.trim().toUpperCase();
    if (!code || !/^[A-Z0-9]{8,24}$/.test(code)) return;
    let active = true;
    const clickKey = `podpilot:affiliate-click:${code}:${window.location.pathname}`;

    validateAffiliateCode(code).then(async (result) => {
      if (!active || !result?.valid || !result?.attribution_token) return;
      storeAffiliateAttribution(result);
      if (sessionStorage.getItem(clickKey)) return;
      sessionStorage.setItem(clickKey, "1");
      await trackAffiliateClick({
        referral_code: result.referral_code,
        anonymous_visitor_id: getAffiliateVisitorId(),
        landing_path: `${window.location.pathname}${window.location.search}`,
        referrer: document.referrer || null,
      });
    }).catch(() => {
      // Invalid public codes are intentionally silent on marketing pages.
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (loading || !user?.id || attributedUserRef.current === user.id) return;
    const stored = readAffiliateAttribution();
    if (!stored?.attribution_token) return;
    attributedUserRef.current = user.id;
    attributeAffiliateReferral({
      attribution_token: stored.attribution_token,
      attribution_source: "first_party_cookie",
    }).then(() => {
      clearAffiliateAttribution();
    }).catch((error) => {
      if ([400, 404].includes(Number(error?.response?.status))) {
        clearAffiliateAttribution();
      } else {
        attributedUserRef.current = "";
      }
    });
  }, [loading, user?.id]);

  return null;
}
