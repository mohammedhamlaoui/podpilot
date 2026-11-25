# PodPilot relaunch billing rollout

## Catalog gate

Do not deploy the relaunch checkout until all six new Paddle prices are active and verified. In Paddle, create or identify these USD recurring prices with `trial_period: null`:

| Environment variable | Amount | Billing interval |
|---|---:|---|
| `PADDLE_REDBUBBLE_MONTHLY_PRICE_ID` | $8.99 | 1 month |
| `PADDLE_REDBUBBLE_ANNUAL_PRICE_ID` | $89.90 | 1 year |
| `PADDLE_TEEPUBLIC_MONTHLY_PRICE_ID` | $8.99 | 1 month |
| `PADDLE_TEEPUBLIC_ANNUAL_PRICE_ID` | $89.90 | 1 year |
| `PADDLE_ALL_PLATFORMS_MONTHLY_PRICE_ID` | $10.99 | 1 month |
| `PADDLE_ALL_PLATFORMS_ANNUAL_PRICE_ID` | $109.90 | 1 year |

Run `python backend/scripts/verify_live_paddle_prices.py --env-file <secure-production-env> --environment production` from the repository root. This read-only script verifies amount, currency, interval, status, and no trial. The backend performs the same check when opening a subscription checkout and fails closed on mismatches.

Before replacing the six current environment values, copy their existing paid Price IDs into the matching `PADDLE_LEGACY_*_PRICE_ID` values. Keep historical trial Price IDs where needed for old subscription event mapping. Do not update existing Paddle subscriptions or archive old prices while subscribers still use them. Leave one-time AI credit price IDs unchanged.

## Refund gate

The 3-day commercial guarantee is hidden unless `VITE_3_DAY_GUARANTEE_CONFIRMED=true` is set for the frontend build. Keep it off until Paddle confirms the seller's operational refund process. Document the support owner, request channel, eligibility review, Paddle adjustment submission, and escalation for a rejected or delayed adjustment. Statutory rights are assessed independently of the 72-hour commercial window.

Approved full refunds of an initial subscription transaction trigger an immediate Paddle cancellation through the webhook. Partial refunds and renewal refunds require manual subscription review; the webhook does not infer that those purchases should end the subscription. Verify the cancellation webhook and access lock in sandbox before enabling the guarantee.
The Paddle API key used by the webhook needs `subscription.read` and `subscription.write` permissions. A failed cancellation leaves the webhook event failed so Paddle can retry; monitor failed events and resolve them promptly.

## Release checks

- Inspect active subscriptions read-only; report unexpected trialing records.
- Test all six new checkout combinations and match the page price to Paddle's base amount and final taxed total.
- Test an existing paid subscriber against a legacy Price ID and verify their old price still displays.
- Test cancellation at period end, approved full initial-payment refund, partial refund, and extension access after cancellation.
- Run frontend build and backend tests.
