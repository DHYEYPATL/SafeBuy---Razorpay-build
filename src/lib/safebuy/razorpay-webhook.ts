import { verifyWebhookSignatureDirect } from "./signature";

export type WebhookEventResult = {
  ok: boolean;
  event?: string;
  paymentId?: string;
  orderId?: string;
  amountPaise?: number;
  status?: string;
  error?: string;
  action: "confirm" | "fail" | "ignored" | "rejected";
};

export function handleRazorpayWebhookPayload(opts: {
  rawBody: string;
  signature: string | null;
  webhookSecret?: string;
}): WebhookEventResult {
  const secret = opts.webhookSecret || process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    return {
      ok: false,
      error: "RAZORPAY_WEBHOOK_SECRET is not configured on the server.",
      action: "rejected",
    };
  }

  if (!opts.signature) {
    return {
      ok: false,
      error: "Missing X-Razorpay-Signature header.",
      action: "rejected",
    };
  }

  const isValid = verifyWebhookSignatureDirect({
    rawBody: opts.rawBody,
    signature: opts.signature,
    webhookSecret: secret,
  });

  if (!isValid) {
    return {
      ok: false,
      error: "Invalid Razorpay webhook signature HMAC mismatch.",
      action: "rejected",
    };
  }

  try {
    const payload = JSON.parse(opts.rawBody) as {
      event?: string;
      payload?: {
        payment?: { entity?: { id: string; order_id: string; amount: number; status: string } };
        order?: { entity?: { id: string; amount: number; status: string } };
      };
    };

    const event = payload.event || "unknown";
    const payment = payload.payload?.payment?.entity;
    const order = payload.payload?.order?.entity;

    const paymentId = payment?.id;
    const orderId = payment?.order_id || order?.id;
    const amountPaise = payment?.amount || order?.amount;
    const status = payment?.status || order?.status;

    if (event === "payment.captured" || event === "order.paid") {
      return {
        ok: true,
        event,
        paymentId,
        orderId,
        amountPaise,
        status: status || "captured",
        action: "confirm",
      };
    }

    if (event === "payment.failed") {
      return {
        ok: true,
        event,
        paymentId,
        orderId,
        amountPaise,
        status: "failed",
        action: "fail",
      };
    }

    return {
      ok: true,
      event,
      paymentId,
      orderId,
      amountPaise,
      status,
      action: "ignored",
    };
  } catch (err) {
    return {
      ok: false,
      error: `Malformed webhook body JSON: ${err instanceof Error ? err.message : String(err)}`,
      action: "rejected",
    };
  }
}
