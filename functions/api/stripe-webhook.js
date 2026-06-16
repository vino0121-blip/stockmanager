const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

export async function onRequestPost({ env, request }) {
  if (!env.BILLING_KV || !env.STRIPE_WEBHOOK_SECRET) {
    return json({ error: "billing_not_configured" }, 500);
  }

  const signature = request.headers.get("stripe-signature") || "";
  const payload = await request.text();
  const verified = await verifyStripeSignature(payload, signature, env.STRIPE_WEBHOOK_SECRET);
  if (!verified) {
    return json({ error: "invalid_signature" }, 400);
  }

  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  if (!event.id || !event.type || !event.data?.object) {
    return json({ error: "invalid_event" }, 400);
  }

  const alreadyHandled = await env.BILLING_KV.get(`event:${event.id}`);
  if (alreadyHandled) return json({ received: true, duplicate: true }, 200);

  const object = event.data.object;

  if (event.type === "checkout.session.completed") {
    await handleCheckoutCompleted(env.BILLING_KV, object);
  }

  if (
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted" ||
    event.type === "customer.subscription.paused" ||
    event.type === "customer.subscription.resumed"
  ) {
    await handleSubscriptionChanged(env.BILLING_KV, object);
  }

  await env.BILLING_KV.put(`event:${event.id}`, "1", { expirationTtl: 60 * 60 * 24 * 30 });
  return json({ received: true }, 200);
}

async function handleCheckoutCompleted(kv, session) {
  const clientReferenceId = session.client_reference_id;
  if (!/^[0-9a-f-]{36}$/i.test(clientReferenceId || "")) return;

  const now = new Date().toISOString();
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : undefined;
  const customerId = typeof session.customer === "string" ? session.customer : undefined;
  const customerEmail = session.customer_details?.email || session.customer_email || undefined;

  const entitlement = {
    active: true,
    plan: "pro",
    activatedAt: now,
    updatedAt: now,
    stripeCheckoutSessionId: session.id,
    stripeCustomerId: customerId,
    stripeCustomerEmail: customerEmail,
    stripeSubscriptionId: subscriptionId,
  };

  await kv.put(`entitlement:${clientReferenceId}`, JSON.stringify(entitlement));
  if (subscriptionId) {
    await kv.put(`subscription:${subscriptionId}`, clientReferenceId);
  }
}

async function handleSubscriptionChanged(kv, subscription) {
  if (!subscription.id) return;
  const clientReferenceId = await kv.get(`subscription:${subscription.id}`);
  if (!clientReferenceId) return;

  const current = (await kv.get(`entitlement:${clientReferenceId}`, { type: "json" })) || {};
  const active = ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status);
  const now = new Date().toISOString();

  await kv.put(
    `entitlement:${clientReferenceId}`,
    JSON.stringify({
      ...current,
      active,
      plan: active ? "pro" : "free",
      updatedAt: now,
      deactivatedAt: active ? undefined : now,
      stripeSubscriptionId: subscription.id,
      stripeSubscriptionStatus: subscription.status,
    }),
  );
}

async function verifyStripeSignature(payload, signatureHeader, secret) {
  const timestamp = signatureHeader
    .split(",")
    .map((part) => part.split("="))
    .find(([key]) => key === "t")?.[1];
  const signatures = signatureHeader
    .split(",")
    .map((part) => part.split("="))
    .filter(([key]) => key === "v1")
    .map(([, value]) => value);

  if (!timestamp || !signatures.length) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  if (Math.abs(Date.now() / 1000 - timestampSeconds) > 60 * 5) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const expected = await hmacSha256Hex(secret, signedPayload);
  return signatures.some((signature) => timingSafeEqual(signature, expected));
}

async function hmacSha256Hex(secret, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return result === 0;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
