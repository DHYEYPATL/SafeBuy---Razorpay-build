import test from "node:test";
import assert from "node:assert/strict";
import { generateX402Challenge, verifyAndIssueX402Token, validateX402Token } from "../x402";

test("x402: returns 402 challenge with valid orderId and amount", () => {
  const challenge = generateX402Challenge("agent_test_session");
  assert.equal(challenge.status, 402);
  assert.equal(challenge.amountPaise, 200);
  assert.equal(challenge.currency, "INR");
  assert.ok(challenge.razorpayOrderId.startsWith("order_x402_"));
  assert.ok(challenge.idempotencyKey.startsWith("x402_idemp_"));
});

test("x402: issues short-lived token upon settlement and validates token", () => {
  const orderId = "order_x402_12345";
  const paymentId = "pay_test_99999";
  const sessionId = "agent_test_session";

  const result = verifyAndIssueX402Token({ orderId, paymentId, sessionId });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.ok(result.token.startsWith("x402_tok_"));
  assert.equal(result.receipt.status, "captured");
  assert.equal(result.receipt.amountPaise, 200);

  // Validate the issued token
  const valid = validateX402Token(result.token, sessionId);
  assert.equal(valid, true);

  // Replay protection: fails for different session
  const replayCrossSession = validateX402Token(result.token, "different_session");
  assert.equal(replayCrossSession, false);

  // Invalid token rejected
  const invalid = validateX402Token("x402_tok_forged_random_123", sessionId);
  assert.equal(invalid, false);
});
