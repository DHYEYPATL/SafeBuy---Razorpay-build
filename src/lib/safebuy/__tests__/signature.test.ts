import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { verifyCheckoutSignatureDirect, verifyWebhookSignatureDirect } from "../signature";

const testSecret = "sec_test_secret_12345";
const testWebhookSecret = "whsec_test_webhook_secret_98765";

test("Signature: verifies valid Razorpay Checkout HMAC signature", () => {
  const orderId = "order_123456";
  const paymentId = "pay_987654";
  const message = `${orderId}|${paymentId}`;
  const validSignature = crypto.createHmac("sha256", testSecret).update(message).digest("hex");

  const isValid = verifyCheckoutSignatureDirect({
    orderId,
    paymentId,
    signature: validSignature,
    secret: testSecret,
  });

  assert.equal(isValid, true);
});

test("Signature: rejects forged or mismatched Checkout signature", () => {
  const orderId = "order_123456";
  const paymentId = "pay_987654";
  const forgedSignature = "0".repeat(64);

  const isValid = verifyCheckoutSignatureDirect({
    orderId,
    paymentId,
    signature: forgedSignature,
    secret: testSecret,
  });

  assert.equal(isValid, false);
});

test("Signature: verifies valid Razorpay webhook raw body signature", () => {
  const rawBody = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: "pay_test", amount: 13500 } } },
  });
  const validSignature = crypto.createHmac("sha256", testWebhookSecret).update(rawBody).digest("hex");

  const isValid = verifyWebhookSignatureDirect({
    rawBody,
    signature: validSignature,
    webhookSecret: testWebhookSecret,
  });

  assert.equal(isValid, true);
});
