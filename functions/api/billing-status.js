export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const clientReferenceId = url.searchParams.get("client_reference_id") || "";

  if (!/^[0-9a-f-]{36}$/i.test(clientReferenceId)) {
    return json({ plan: "free" }, 400);
  }

  if (!env.BILLING_KV) {
    return json({ plan: "free", reason: "billing_not_configured" }, 200);
  }

  const entitlement = await env.BILLING_KV.get(`entitlement:${clientReferenceId}`, {
    type: "json",
  });

  if (!entitlement || entitlement.active !== true) {
    return json({ plan: "free" }, 200);
  }

  return json(
    {
      plan: "pro",
      activatedAt: entitlement.activatedAt,
    },
    200,
  );
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
