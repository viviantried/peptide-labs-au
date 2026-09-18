# Stripe card checkout

The store cart uses hosted Stripe Checkout. The card choice appears only when `STRIPE_ENABLED=true`, `STRIPE_PRODUCT_ELIGIBLE=true`, and both Stripe secrets exist in that Vercel environment. Bank transfer remains available.

## Preview test setup

1. Add `STRIPE_SECRET_KEY=sk_test_...` to the **Preview** environment of the `peptide-labs-au` Vercel project. Set `STRIPE_PRODUCT_ELIGIBLE=true` and `STRIPE_ENABLED=true` in Preview. Leave `STRIPE_ENABLED=false` in Production.
2. Deploy this branch to Vercel Preview and copy its exact deployment URL.
3. In Stripe **Test mode**, create a webhook destination for `<preview deployment URL>/api/stripe-webhook` with `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Add that destination's `whsec_...` signing secret as `STRIPE_WEBHOOK_SECRET` in Vercel **Preview**. Test and live signing secrets are different.
4. Redeploy Preview after adding or changing environment variables. Ensure the existing `RESEND_API_KEY` and `AIRTABLE_TOKEN` are also present in Preview; the paid-order webhook needs both.
5. Test a successful and declined Stripe test card, cancellation, a valid signed webhook, and duplicate delivery. Confirm the exact amount, one Airtable paid order, and customer and owner emails. Check that cancelled and declined payments create no paid order.

## Production launch

The account owner confirmed Stripe has approved the research peptide products. Set `STRIPE_SECRET_KEY=sk_live_...` and the existing **live** webhook destination's signing secret in Vercel Production. Confirm `RESEND_API_KEY` and `AIRTABLE_TOKEN` there. After Preview passes, set `STRIPE_PRODUCT_ELIGIBLE=true` and `STRIPE_ENABLED=true` in Production and redeploy.

The webhook verifies Stripe's signature and payment status before recording an order. It uses Resend idempotency keys and an Airtable lookup to reduce duplicate processing. Airtable does not enforce unique order IDs, so concurrent duplicate deliveries can still create duplicate records. Stock is checked at session creation but is not reserved or decremented atomically; staff must check it during fulfilment.
