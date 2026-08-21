import crypto from "node:crypto";
import { createServerFn } from "@tanstack/react-start";

/**
 * Verifies the Razorpay Checkout handler HMAC-SHA256 signature.
 * Expected payload from Razorpay Checkout.js:
 *   orderId: razorpay_order_id
 *   paymentId: razorpay_payment_id
 *   signature: razorpay_signature (HMAC_SHA256(orderId + "|" + paymentId, secret))
 */
export function verifyCheckoutSignatureDirect(opts: {
  orderId: string;
  paymentId: string;
  signature: string;
  secret: string;
}): boolean {
  if (!opts.orderId || !opts.paymentId || !opts.signature || !opts.secret) {
    return false;
  }
  try {
    const message = `${opts.orderId}|${opts.paymentId}`;
    const expected = crypto.createHmac("sha256", opts.secret).update(message).digest("hex");
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(opts.signature, "utf8");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Verifies the Razorpay Webhook header signature against raw request body.
 */
export function verifyWebhookSignatureDirect(opts: {
  rawBody: string;
  signature: string;
  webhookSecret: string;
}): boolean {
  if (!opts.rawBody || !opts.signature || !opts.webhookSecret) {
    return false;
  }
  try {
    const expected = crypto.createHmac("sha256", opts.webhookSecret).update(opts.rawBody).digest("hex");
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(opts.signature, "utf8");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Server function to verify Checkout handler signature from the frontend
 */
export const verifyCheckoutSignature = createServerFn({ method: "POST" })
  .validator((input: { orderId: string; paymentId: string; signature: string }) => input)
  .handler(async ({ data }) => {
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) {
      return { ok: false as const, error: "RAZORPAY_KEY_SECRET missing on server." };
    }
    const isValid = verifyCheckoutSignatureDirect({
      orderId: data.orderId,
      paymentId: data.paymentId,
      signature: data.signature,
      secret,
    });
    return { ok: isValid, error: isValid ? null : "Invalid checkout signature HMAC." };
  });
