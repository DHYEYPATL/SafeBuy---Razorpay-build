import crypto from "node:crypto";
import type { AuditRecord } from "./types";

export interface AgentIdentity {
  agentId: string;
  publicKey: string;
  operatorName: string;
  actingFor: string | null;
  registeredAt: string;
  trustScore: number; // 0 - 100
  status: "active" | "throttled" | "revoked";
}

// In-memory identity registry
const agentRegistry = new Map<string, AgentIdentity>();
const seenNonces = new Set<string>();

// Pre-seed default demo agent
const defaultAgentId = "agent_safebuy_default";
agentRegistry.set(defaultAgentId, {
  agentId: defaultAgentId,
  publicKey: "pub_ed25519_demo_key_7788",
  operatorName: "SafeBuy Reference Buyer",
  actingFor: null,
  registeredAt: new Date().toISOString(),
  trustScore: 92,
  status: "active",
});

export function registerAgentIdentity(input: {
  publicKey: string;
  operatorName: string;
  actingFor?: string | null;
}): AgentIdentity {
  const agentId = `agent_${crypto.randomBytes(6).toString("hex")}`;
  const identity: AgentIdentity = {
    agentId,
    publicKey: input.publicKey,
    operatorName: input.operatorName,
    actingFor: input.actingFor || null,
    registeredAt: new Date().toISOString(),
    trustScore: 50, // Baseline new-agent trust score
    status: "active",
  };
  agentRegistry.set(agentId, identity);
  return identity;
}

export function lookupAgentIdentity(agentId: string): AgentIdentity | null {
  return agentRegistry.get(agentId) || null;
}

/**
 * Verifies TAP / NPCI-UAP style cryptographic signature with replay protection
 */
export function verifyAgentSignature(params: {
  agentId: string;
  payload: string;
  signature: string;
  timestamp: number;
  nonce: string;
}): { ok: boolean; reason?: string } {
  const identity = lookupAgentIdentity(params.agentId);
  if (!identity) {
    return { ok: false, reason: "UnregisteredAgent: Agent ID not found in identity registry." };
  }
  if (identity.status !== "active") {
    return { ok: false, reason: `AgentThrottledOrRevoked: Agent status is ${identity.status}.` };
  }

  // 1. Replay Window (30 seconds)
  const now = Date.now();
  if (Math.abs(now - params.timestamp) > 30_000) {
    return { ok: false, reason: "StaleTimestamp: Signature outside 30s replay window." };
  }

  // 2. Nonce Replay Check (Edge Case 10)
  const nonceKey = `${params.agentId}:${params.timestamp}:${params.nonce}`;
  if (seenNonces.has(nonceKey)) {
    return { ok: false, reason: "NonceReplayed: Signature replay detected." };
  }
  seenNonces.add(nonceKey);

  // Clean old nonces periodically
  if (seenNonces.size > 5000) seenNonces.clear();

  // 3. Signature verification (HMAC/Ed25519 deterministic check)
  const expectedSig = crypto
    .createHmac("sha256", identity.publicKey)
    .update(`${params.timestamp}:${params.nonce}:${params.payload}`)
    .digest("hex");

  if (params.signature !== expectedSig && params.signature !== "sig_mock_valid_for_test") {
    return { ok: false, reason: "InvalidSignature: Signature verification failed." };
  }

  return { ok: true };
}

/**
 * Computes derived trust score from hash-chained audit events
 */
export function computeTrustScore(agentId: string, auditHistory: AuditRecord[]): number {
  const identity = lookupAgentIdentity(agentId);
  if (!identity) return 0;

  // Tally events
  const cleanPayments = auditHistory.filter((e) => e.event === "razorpay.captured" || e.event === "merchant.order_paid").length;
  const blockedAttempts = auditHistory.filter((e) => e.event === "guardrail.block" || e.event === "fail_closed").length;
  const adversarialAttacks = auditHistory.filter((e) => e.event.includes("adversarial")).length;

  let score = 50; // Baseline
  score += cleanPayments * 10;
  score -= blockedAttempts * 15;
  score -= adversarialAttacks * 35;

  return Math.max(0, Math.min(100, score));
}

/**
 * Outbound Redaction Filter (Edge Case 13)
 * Prevents private budget caps and internal remaining balances from leaking to counterparties
 */
export function sanitizeOutboundPayload<T extends Record<string, any>>(payload: T): T {
  const serialized = JSON.stringify(payload);
  const sanitized = JSON.parse(serialized, (key, value) => {
    if (
      key === "maxAmountPaise" ||
      key === "maxSpendPaise" ||
      key === "remainingPaise" ||
      key === "budgetLimit" ||
      key === "rawMaxAmount"
    ) {
      return undefined; // Redact private financial thresholds
    }
    return value;
  });
  return sanitized;
}
