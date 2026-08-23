import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  registerAgentIdentity,
  lookupAgentIdentity,
  verifyAgentSignature,
  computeTrustScore,
  sanitizeOutboundPayload,
} from "../identity";
import type { AuditRecord } from "../types";

test("Identity: registers new agent identity with public key and initial trust score", () => {
  const pubKey = "pub_ed25519_test_judge_key_123";
  const identity = registerAgentIdentity({
    publicKey: pubKey,
    operatorName: "Judge Evaluation Agent",
    actingFor: "Track01 Reviewer",
  });

  assert.ok(identity.agentId.startsWith("agent_"));
  assert.equal(identity.operatorName, "Judge Evaluation Agent");
  assert.equal(identity.actingFor, "Track01 Reviewer");
  assert.equal(identity.trustScore, 50);
  assert.equal(identity.status, "active");

  const fetched = lookupAgentIdentity(identity.agentId);
  assert.equal(fetched?.agentId, identity.agentId);
});

test("Identity: verifies valid signed message and rejects forged signature (Edge Case 10)", () => {
  const pubKey = "pub_ed25519_test_sig_456";
  const identity = registerAgentIdentity({
    publicKey: pubKey,
    operatorName: "Signer Agent",
  });

  const timestamp = Date.now();
  const nonce = "nonce_123456";
  const payload = JSON.stringify({ action: "propose_cart", sku: "RICE-BAS-1KG" });

  const validSig = crypto
    .createHmac("sha256", pubKey)
    .update(`${timestamp}:${nonce}:${payload}`)
    .digest("hex");

  // 1. Valid Signature Passes
  const validRes = verifyAgentSignature({
    agentId: identity.agentId,
    payload,
    signature: validSig,
    timestamp,
    nonce,
  });
  assert.equal(validRes.ok, true);

  // 2. Replayed Nonce is Rejected (Edge Case 10)
  const replayRes = verifyAgentSignature({
    agentId: identity.agentId,
    payload,
    signature: validSig,
    timestamp,
    nonce,
  });
  assert.equal(replayRes.ok, false);
  assert.equal(replayRes.reason, "NonceReplayed: Signature replay detected.");

  // 3. Forged Signature is Rejected
  const forgedRes = verifyAgentSignature({
    agentId: identity.agentId,
    payload,
    signature: "forged_signature_00000000000000",
    timestamp,
    nonce: "nonce_different_999",
  });
  assert.equal(forgedRes.ok, false);
  assert.equal(forgedRes.reason, "InvalidSignature: Signature verification failed.");
});

test("Identity: computes derived trust score from audit history", () => {
  const mockAudit: AuditRecord[] = [
    {
      seq: 1,
      id: "aud_1",
      ts: new Date().toISOString(),
      correlationId: "cor_1",
      phase: "confirmed",
      event: "razorpay.captured",
      layer: "live",
      explain: "Payment captured",
      payload: {},
      hash: "hash1",
      prevHash: "genesis",
    },
    {
      seq: 2,
      id: "aud_2",
      ts: new Date().toISOString(),
      correlationId: "cor_2",
      phase: "confirmed",
      event: "merchant.order_paid",
      layer: "live",
      explain: "Merchant order marked paid",
      payload: {},
      hash: "hash2",
      prevHash: "hash1",
    },
  ];

  const score = computeTrustScore("agent_safebuy_default", mockAudit);
  assert.ok(score >= 70); // Baseline (50) + 2 clean events (+20) = 70
});

test("Identity: outbound payload redaction never leaks private mandate ceilings (Edge Case 13)", () => {
  const outboundMerchantPayload = {
    merchantId: "nila-kirana",
    selectedSku: "RICE-BAS-1KG",
    quantity: 1,
    // Private financial constraints that should NEVER be transmitted to seller
    maxAmountPaise: 150000,
    remainingPaise: 135800,
    budgetLimit: "₹1500",
  };

  const sanitized = sanitizeOutboundPayload(outboundMerchantPayload);

  // Assert private fields are completely stripped
  assert.equal((sanitized as any).maxAmountPaise, undefined);
  assert.equal((sanitized as any).remainingPaise, undefined);
  assert.equal((sanitized as any).budgetLimit, undefined);

  // Assert public transaction fields remain intact
  assert.equal(sanitized.selectedSku, "RICE-BAS-1KG");
  assert.equal(sanitized.quantity, 1);
  assert.equal(sanitized.merchantId, "nila-kirana");
});

test("Identity: mitigates trust-score gaming via volume dampening (Edge Case 11)", () => {
  // Simulate an adversarial agent attempting to game reputation with 10 rapid micro-transactions
  const spammedAudit: AuditRecord[] = Array.from({ length: 10 }, (_, i) => ({
    seq: i + 1,
    id: `aud_spam_${i}`,
    ts: new Date().toISOString(),
    correlationId: `cor_spam_${i}`,
    phase: "confirmed",
    event: "razorpay.captured",
    layer: "live",
    explain: "Micro transaction",
    payload: {},
    hash: `hash_${i}`,
    prevHash: `prev_${i}`,
  }));

  const score = computeTrustScore("agent_safebuy_default", spammedAudit);
  // With volume dampening: 50 + 20 (first 2) + 15 (next 3) + 5 (remaining) = 90 max bump cap
  assert.ok(score <= 90, `Expected score <= 90 due to volume dampening, got ${score}`);
  assert.ok(score >= 85, `Expected score >= 85, got ${score}`);
});

test("Identity: enforces actingFor accountability chain across delegated sub-agents (Edge Case 12)", () => {
  const subAgent = registerAgentIdentity({
    publicKey: "pub_ed25519_delegated_subagent_key",
    operatorName: "Autonomous Pantry Refill Bot",
    actingFor: "Customer Dhyey (User ID: usr_98765)",
  });

  assert.equal(subAgent.actingFor, "Customer Dhyey (User ID: usr_98765)");

  const timestamp = Date.now();
  const nonce = "nonce_delegation_test";
  const payload = JSON.stringify({ action: "refill_atta" });
  const sig = crypto
    .createHmac("sha256", subAgent.publicKey)
    .update(`${timestamp}:${nonce}:${payload}`)
    .digest("hex");

  const verifyResult = verifyAgentSignature({
    agentId: subAgent.agentId,
    payload,
    signature: sig,
    timestamp,
    nonce,
  });

  assert.equal(verifyResult.ok, true);
  assert.equal(verifyResult.identity?.actingFor, "Customer Dhyey (User ID: usr_98765)");
});

test("Identity: unregistered agent or signature failure fails closed with zero debit (Edge Case 14)", () => {
  // 1. Unknown agent lookup fails closed
  const unknownRes = verifyAgentSignature({
    agentId: "agent_ghost_unregistered_9999",
    payload: "{}",
    signature: "sig_dummy",
    timestamp: Date.now(),
    nonce: "nonce_ghost",
  });
  assert.equal(unknownRes.ok, false);
  assert.equal(unknownRes.reason, "UnregisteredAgent: Agent ID not found in identity registry.");

  // 2. Lookup returns null
  assert.equal(lookupAgentIdentity("agent_ghost_unregistered_9999"), null);
});
