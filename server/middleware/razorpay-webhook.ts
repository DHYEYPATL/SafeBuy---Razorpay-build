import { handleRazorpayWebhookPayload } from "../../src/lib/safebuy/razorpay-webhook";
import { useSafeBuy } from "../../src/lib/safebuy/store";

interface RazorpayWebhookEvent {
  url: URL;
  req: {
    method: string;
    headers: Headers;
  };
  request?: Request;
}

export default async function razorpayWebhookMiddleware(
  event: RazorpayWebhookEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const method = (event.req.method ?? "GET").toUpperCase();
  const path = event.url.pathname;

  if (path !== "/api/razorpay/webhook") {
    return next();
  }

  if (method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    let rawBody = "";
    if (event.request) {
      rawBody = await event.request.text();
    }
    const signature = event.req.headers.get("x-razorpay-signature");

    const result = handleRazorpayWebhookPayload({
      rawBody,
      signature,
    });

    if (!result.ok || result.action === "rejected") {
      return new Response(JSON.stringify({ ok: false, error: result.error }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    if (result.action === "confirm" && result.paymentId) {
      await useSafeBuy.getState().applyConfirm({
        paymentId: result.paymentId,
        orderId: result.orderId,
        amountPaise: result.amountPaise,
        status: result.status,
        source: "webhook",
      });
    } else if (result.action === "fail") {
      await useSafeBuy.getState().failClosed(`Webhook reported payment failure: ${result.event}`);
    }

    return new Response(JSON.stringify({ ok: true, received: true, action: result.action }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
}
