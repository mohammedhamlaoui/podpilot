export const LIVE_PRICES = {
  redbubble: {
    monthly: {
      trial: "pri_01ktpvtc6gmzyrvpwkvf3hbb4g",
      no_trial: "pri_01ktpw0tp8eat88076zcxzvsn3",
    },
    annual: {
      trial: "pri_01ktpvw8gzcp4kqtp0dmz20mca",
      no_trial: "pri_01ktpw024fdhrmamvvepkqkgvk",
    },
  },
  teepublic: {
    monthly: {
      trial: "pri_01ktpw4w40em67xhj8f09y84rg",
      no_trial: "pri_01ktpwbz6sss2xk225bf382vjr",
    },
    annual: {
      trial: "pri_01ktpwcnn5qwq8c0fpznebf2xn",
      no_trial: "pri_01ktpwd7h3p4gbnfgqd9cq19jh",
    },
  },
  all_platforms: {
    monthly: {
      trial: "pri_01ktpxvt2ybj8w2dt9b3b43cxm",
      no_trial: "pri_01ktpy0fz9bjmh9gd4kzbta53c",
    },
    annual: {
      trial: "pri_01ktpy7m3p9epe0d3sqc2hsk80",
      no_trial: "pri_01ktpy87y4wz6k061kb5e2p08r",
    },
  },
  ai_credits: {
    ai_250: "pri_01ktpypvykz2xc6y5n6pb1nxe9",
    ai_500: "pri_01ktpyqe5z0v82zd4x3c5wvmm8",
    ai_1000: "pri_01ktpyrg5eaeyhr5ethm11awfq",
    ai_2500: "pri_01ktpys919mc2pqyhqrfv8z9x6",
    ai_5000: "pri_01ktpzh04zbx8x91xsc1af1heg",
    ai_10000: "pri_01ktpytpg0e6dsqqf25pczqqy5",
  },
};

export function getPaddlePrice({ plan, billing, trialEligible }) {
  const prices = LIVE_PRICES;

  const normalizedPlan = String(plan || "").toLowerCase().trim().replace("-", "_");
  let planKey = normalizedPlan;
  if (planKey === "tokens_1000") planKey = "ai_1000";
  if (planKey === "tokens_10000") planKey = "ai_10000";

  if (planKey.startsWith("ai_") || planKey.startsWith("tokens_")) {
    const aiKey = planKey.replace("credits_", ""); // e.g. ai_credits_250 -> ai_250
    return prices.ai_credits[aiKey] || "";
  }

  const cycle = String(billing || "monthly").toLowerCase().trim() === "annual" ? "annual" : "monthly";
  const trialKey = trialEligible ? "trial" : "no_trial";

  return prices[planKey]?.[cycle]?.[trialKey] || "";
}
