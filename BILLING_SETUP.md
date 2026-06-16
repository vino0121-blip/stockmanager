# Billing setup

The app does not trust `?billing=success`.

Pro access is granted only after Stripe sends a verified webhook to Cloudflare Pages Functions.

## Cloudflare

1. Create a KV namespace for billing entitlements.
2. Bind it to the Pages project as:

```text
BILLING_KV
```

3. Add this Pages environment variable:

```text
STRIPE_WEBHOOK_SECRET=whsec_...
```

## Stripe

Create a webhook endpoint:

```text
https://tcg-stock.com/api/stripe-webhook
```

Listen for these events:

```text
checkout.session.completed
customer.subscription.updated
customer.subscription.deleted
customer.subscription.paused
customer.subscription.resumed
```

The app appends `client_reference_id` to the Stripe Payment Link. Stripe includes that value in the
`checkout.session.completed` webhook, and the webhook stores the matching Pro entitlement in KV.

## Redirects

Use these URLs for the Payment Link if you configure redirect behavior:

```text
Success: https://tcg-stock.com/app?checkout=success
Cancel:  https://tcg-stock.com/app?checkout=cancel
```

Do not use `?billing=success`; the app ignores it.
