const PADDLE_ENVIRONMENT = import.meta.env.VITE_PADDLE_ENVIRONMENT || "sandbox";

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

export const SANDBOX_PRICES = {
  redbubble: {
    monthly: {
      trial: import.meta.env.VITE_PADDLE_REDBUBBLE_PRICE_ID || "pri_01ks8msd36y7rs8yssgwdrtm9w",
      no_trial: import.meta.env.VITE_PADDLE_REDBUBBLE_PRICE_ID || "pri_01ks8msd36y7rs8yssgwdrtm9w",
    },
    annual: {
      trial: import.meta.env.VITE_PADDLE_REDBUBBLE_ANNUAL_PRICE_ID || "pri_01ksqtcsvsg25mwt5jmmbgfq9h",
      no_trial: import.meta.env.VITE_PADDLE_REDBUBBLE_ANNUAL_PRICE_ID || "pri_01ksqtcsvsg25mwt5jmmbgfq9h",
    },
  },
  teepublic: {
    monthly: {
      trial: import.meta.env.VITE_PADDLE_TEEPUBLIC_PRICE_ID || "pri_01ks8mz28veqdt6sr3p80zcjcb",
      no_trial: import.meta.env.VITE_PADDLE_TEEPUBLIC_PRICE_ID || "pri_01ks8mz28veqdt6sr3p80zcjcb",
    },
    annual: {
      trial: import.meta.env.VITE_PADDLE_TEEPUBLIC_ANNUAL_PRICE_ID || "pri_01ksqteacy6f3kywzdxkarecm9",
      no_trial: import.meta.env.VITE_PADDLE_TEEPUBLIC_ANNUAL_PRICE_ID || "pri_01ksqteacy6f3kywzdxkarecm9",
    },
  },
  all_platforms: {
    monthly: {
      trial: import.meta.env.VITE_PADDLE_ALL_PLATFORMS_PRICE_ID || "pri_01ks8n0g4v8f9nq71yzqhkagt3",
      no_trial: import.meta.env.VITE_PADDLE_ALL_PLATFORMS_PRICE_ID || "pri_01ks8n0g4v8f9nq71yzqhkagt3",
    },
    annual: {
      trial: import.meta.env.VITE_PADDLE_ALL_PLATFORMS_ANNUAL_PRICE_ID || "pri_01ksqth3g45j22m9ye6s8sb6m8",
      no_trial: import.meta.env.VITE_PADDLE_ALL_PLATFORMS_ANNUAL_PRICE_ID || "pri_01ksqth3g45j22m9ye6s8sb6m8",
    },
  },
  ai_credits: {
    ai_250: "pri_01ks8n5345bwms59tp4ayz0rqp",
    ai_500: "pri_01ks8n5345bwms59tp4ayz0rqp",
    ai_1000: import.meta.env.VITE_PADDLE_AI_TOKENS_1000_PRICE_ID || "pri_01ks8n5345bwms59tp4ayz0rqp",
    ai_2500: "pri_01ks8n74nkvh85t5trtjk99bcb",
    ai_5000: "pri_01ks8n74nkvh85t5trtjk99bcb",
    ai_10000: import.meta.env.VITE_PADDLE_AI_TOKENS_10000_PRICE_ID || "pri_01ks8n74nkvh85t5trtjk99bcb",
  },
};

export function getPaddlePrice({ plan, billing, trialEligible }) {
  const isProduction = PADDLE_ENVIRONMENT === "production";
  const prices = isProduction ? LIVE_PRICES : SANDBOX_PRICES;

  const normalizedPlan = String(plan || "").toLowerCase().trim().replace("-", "_");
  let planKey = normalizedPlan === "growth" ? "all_platforms" : normalizedPlan;
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
