export const AFA_EXEMPT_PAISE = 1_500_000; // ₹15,000
export const DEMO_NOTIFY_WINDOW_MS = 5_000;
export const MERCHANT_ID = "nila-kirana";
export const MERCHANT_NAME = "Nila Kirana";

export const CATEGORIES = [
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

export type MandateStatus = "active" | "revoked";

export type AgentPhase =
  | "idle"
  | "planning"
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
  | "fail_closed"
  | "none";

export type LabInject =
  | "none"
  | "soft_decline"
  | "stock_race"
  | "semantic_mismatch"
  | "afa_threshold"
  | "revoke_in_window";

export interface StructuredIntent {
  maxAmountPaise: number | null;
  categories: Category[];
  brandsAllow: string[];
  brandsDeny: string[];
  maxQuantityPerItem: number | null;
  priceCeilingPerItemPaise: number | null;
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
  revokedAt: string | null;
  afaSimulatedAt: string;
  afaMethod: "simulated_upi_pin";
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
