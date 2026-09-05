export const AFA_EXEMPT_PAISE = 5_000_000; // ₹50,000 ceiling for high-end electronics
export const DEMO_NOTIFY_WINDOW_MS = 8_000; // 8 seconds for readable dwell
export const MERCHANT_ID = "electrocore-ai";
export const MERCHANT_NAME = "ElectroCore";

export const CATEGORIES = [
  "audio",
  "peripherals",
  "power",
  "cables",
  "storage",
  "accessories",
  "grains",
  "pulses",
  "spices",
  "oil",
  "dairy",
  "snacks",
  "beverages",
  "household",
] as const;

export type Category = (typeof CATEGORIES)[number];

export type LayerKind = "live" | "synthetic";

export type MandateStatus = "active" | "revoked" | "expired";

export type AgentPhase =
  | "idle"
  | "planning"
  | "ask_back"
  | "guardrail"
  | "notify"
  | "window"
  | "execute"
  | "pending"
  | "confirmed"
  | "failed"
  | "stopped"
  | "needs_confirm";

export type FailureKind =
  | "soft_decline"
  | "stock_race"
  | "semantic_mismatch"
  | "afa_threshold"
  | "mandate_exceeded"
  | "mandate_revoked"
  | "mandate_expired"
  | "fail_closed"
  | "none";

export type LabInject =
  | "none"
  | "soft_decline"
  | "stock_race"
  | "semantic_mismatch"
  | "afa_threshold"
  | "revoke_in_window"
  | "replay_attack"
  | "untrusted_agent";

export interface StructuredIntent {
  maxAmountPaise: number | null;
  categories: Category[];
  brandsAllow: string[];
  brandsDeny: string[];
  maxQuantityPerItem: number | null;
  priceCeilingPerItemPaise: number | null;
  packTokens: string[];        // Specific search terms e.g. ["basmati", "headphones"]
  excludeTokens: string[];     // Denied terms e.g. ["atta", "chocolate"]
  qty: number | null;          // Number of packs requested
  packSizeHint: string | null; // e.g. "1kg", "5kg", "500g"
  queryText: string;
}

export interface Mandate {
  id: string;
  status: MandateStatus;
  merchantId: string;
  maxAmountPaise: number;
  remainingPaise: number;
  spentPaise: number;
  categories: Category[];
  brandsAllow: string[];
  brandsDeny: string[];
  maxQuantityPerItem: number;
  priceCeilingPerItemPaise: number;
  createdAt: string;
  validUntil: string;
  revokedAt: string | null;
  authorizedBy: string;
  authorizationMethod: "simulated_registration_auth";
}

export interface CatalogItem {
  sku: string;
  name: string;
  brand: string;
  category: Category;
  pricePaise: number;
  unit: string;
  stock: number;
  description: string;
  specs?: Record<string, string | number>;
  imageEmoji?: string;
  rating?: number;
  tags?: string[];
  isFeatured?: boolean;
}

export interface ShortlistItem {
  badge: "BEST MATCH" | "ALTERNATIVE" | "OPTION 03" | "RECOMMENDED";
  sku: string;
  name: string;
  brand: string;
  pricePaise: number;
  stock: number;
  unit: string;
  reason: string;
  specsHighlight?: string;
}

export interface EvaluationDetail {
  consideredCount: number;
  primaryMatch: string;
  primaryReason: string;
  rejected: Array<{ name: string; reason: string }>;
}

export interface CartLine {
  sku: string;
  name: string;
  brand: string;
  category: Category;
  unitPricePaise: number;
  quantity: number;
  linePaise: number;
}

export interface ProposedCart {
  lines: CartLine[];
  totalPaise: number;
  merchantId: string;
  merchantName: string;
  reason: string;
  needsClarification?: boolean;
  clarificationPrompt?: string;
}

export interface PreDebitNotice {
  id: string;
  attemptId: string;
  amountPaise: number;
  skus: string[];
  merchantId: string;
  merchantName: string;
  issuedAt: string;
  executeAfter: string;
  dwellMs: number;
  status: "issued" | "cancelled" | "executed" | "expired";
}

export interface MerchantOrder {
  id: string;
  merchantId: string;
  merchantName: string;
  attemptId: string;
  lines: CartLine[];
  totalPaise: number;
  status: "reserved" | "paid" | "released" | "cancelled";
  reservedAt: string;
  paidAt: string | null;
  razorpayOrderId: string | null;
}

export interface GuardrailResult {
  ok: boolean;
  code: FailureKind | "pass";
  title: string;
  detail: string;
  needsHumanConfirm: boolean;
}

export interface AuditRecord {
  seq: number;
  id: string;
  correlationId: string;
  ts: string;
  phase: AgentPhase;
  event: string;
  explain: string;
  layer: LayerKind;
  payload: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

export interface PurchaseAttempt {
  id: string;
  correlationId: string;
  mandateId: string;
  cart: ProposedCart;
  intent: StructuredIntent;
  phase: AgentPhase;
  failure: FailureKind;
  noticeId: string | null;
  merchantOrderId: string | null;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  razorpaySignature: string | null;
  razorpayStatus: "none" | "created" | "pending" | "captured" | "failed" | "unknown";
  confirmSource: "none" | "handler_unverified" | "fetch" | "webhook";
  attemptsCharge: number;
  notifyAt: string | null;
  executeAt: string | null;
  confirmedAt: string | null;
  createdAt: string;
}

// AP2 Primitive Data Models
export interface AP2IntentMandate {
  version: "ap2.intent_mandate.v1";
  mandateId: string;
  merchantId: string;
  maxSpendPaise: number;
  allowedCategories: Category[];
  deniedBrands: string[];
  validUntil: string;
  authorizedBy: string;
  authorizedAt: string;
}

export interface AP2CartMandate {
  version: "ap2.cart_mandate.v1";
  attemptId: string;
  merchantOrderId: string;
  lockedSkus: Array<{ sku: string; qty: number; unitPricePaise: number }>;
  totalPaise: number;
  guardrailProof: { passedAt: string; code: string };
}

export interface AP2PaymentMandate {
  version: "ap2.payment_mandate.v1";
  attemptId: string;
  noticeId: string;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  amountPaise: number;
  reconciliationStatus: string;
  confirmedAt: string | null;
}
