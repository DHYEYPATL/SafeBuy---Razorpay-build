import crypto from "node:crypto";
import { CATALOG } from "./catalog";
import type { CatalogItem } from "./types";
import { verifyCheckoutSignatureDirect } from "./signature";

export interface AP2AccessReceipt {
  agentSessionId: string;
  amountPaise: number;
  razorpayOrderId: string;
  razorpayPaymentId: string | null;
  tokenIssuedAt: string | null;
  tokenExpiresAt: string | null;
  status: "pending" | "captured" | "expired" | "revoked";
}

export const PREMIUM_CATALOG: CatalogItem[] = [
  {
    sku: "BULK-BAS-25KG",
    name: "Aged Basmati Rice 25 kg (Wholesale Sack)",
    brand: "India Gate",
    category: "grains",
    pricePaise: 275000,
    unit: "25 kg",
    stock: 50,
    description: "Premium wholesale bulk sack (₹110/kg — 22% off standard retail).",
  },
  {
    sku: "BULK-OIL-15L",
    name: "Mustard Oil 15 L (Commercial Tin)",
    brand: "Fortune",
    category: "oil",
    pricePaise: 235000,
    unit: "15 L",
    stock: 25,
    description: "Cold-pressed bulk commercial tin for institutional buyers.",
  },
  {
    sku: "BULK-ATA-50KG",
    name: "Chakki Fresh Atta 50 kg (Commercial Sack)",
    brand: "Aashirvaad",
    category: "grains",
    pricePaise: 240000,
    unit: "50 kg",
    stock: 30,
    description: "Wholesale bakery grade wheat flour.",
  },
];

// In-memory active tokens cache: token -> { expiresAt, orderId, sessionId }
const activeTokens = new Map<string, { expiresAt: number; orderId: string; sessionId: string }>();

const X402_SECRET = process.env.RAZORPAY_KEY_SECRET || "safebuy_x402_secret_key";
export const PREMIUM_ACCESS_FEE_PAISE = 200; // ₹2 micro-fee

export function generateX402Challenge(sessionId = "agent_default"): {
  status: 402;
  amountPaise: number;
  currency: string;
  razorpayOrderId: string;
  idempotencyKey: string;
  protocol: "x402-ap2-monetization-v1";
} {
  const idempotencyKey = `x402_idemp_${crypto.randomBytes(6).toString("hex")}`;
  const mockOrderId = `order_x402_${crypto.randomBytes(6).toString("hex")}`;

  return {
    status: 402,
    amountPaise: PREMIUM_ACCESS_FEE_PAISE,
    currency: "INR",
    razorpayOrderId: mockOrderId,
    idempotencyKey,
    protocol: "x402-ap2-monetization-v1",
  };
}

export function verifyAndIssueX402Token(params: {
  orderId: string;
  paymentId: string;
  signature?: string | null;
  sessionId?: string;
  keySecret?: string;
}): { ok: true; token: string; expiresAt: string; receipt: AP2AccessReceipt } | { ok: false; error: string } {
  const secret = params.keySecret || X402_SECRET;
  const sessionId = params.sessionId || "agent_default";

  // Signature verification (reusing existing timing-safe HMAC logic)
  if (params.signature && secret) {
    const verified = verifyCheckoutSignatureDirect({
      orderId: params.orderId,
      paymentId: params.paymentId,
      signature: params.signature,
      secret,
    });
    if (!verified) {
      return { ok: false, error: "Invalid payment signature for x402 settlement." };
    }
  }

  // Issue 15-minute token
  const token = `x402_tok_${crypto.randomBytes(16).toString("hex")}`;
  const now = Date.now();
  const expiresAtMs = now + 15 * 60 * 1000; // 15 mins
  const expiresAtIso = new Date(expiresAtMs).toISOString();

  activeTokens.set(token, {
    expiresAt: expiresAtMs,
    orderId: params.orderId,
    sessionId,
  });

  const receipt: AP2AccessReceipt = {
    agentSessionId: sessionId,
    amountPaise: PREMIUM_ACCESS_FEE_PAISE,
    razorpayOrderId: params.orderId,
    razorpayPaymentId: params.paymentId,
    tokenIssuedAt: new Date(now).toISOString(),
    tokenExpiresAt: expiresAtIso,
    status: "captured",
  };

  return {
    ok: true,
    token,
    expiresAt: expiresAtIso,
    receipt,
  };
}

export function validateX402Token(token: string | null | undefined, sessionId = "agent_default"): boolean {
  if (!token) return false;
  const clean = token.replace(/^Bearer\s+/i, "").trim();
  const record = activeTokens.get(clean);
  if (!record) return false;

  if (Date.now() > record.expiresAt) {
    activeTokens.delete(clean);
    return false;
  }

  // Cross-session replay protection
  if (record.sessionId && record.sessionId !== sessionId) {
    return false;
  }

  return true;
}
