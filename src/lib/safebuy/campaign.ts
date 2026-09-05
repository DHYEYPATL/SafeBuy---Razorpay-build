import {
  MERCHANT_ID,
  MERCHANT_NAME,
  type AuditRecord,
  type CartLine,
  type Mandate,
  type ProposedCart,
} from "./types";
import { getItem } from "./catalog";
import { lookupAgentIdentity } from "./identity";

export interface CampaignOffer {
  id: string;
  name: string;
  badge: string;
  description: string;
  ruleTrigger: string;
  originalTotalPaise: number;
  discountedTotalPaise: number;
  savingsPaise: number;
  savingsPercent: number;
  lines: CartLine[];
  withinMandateLimit: boolean;
}

export const CAMPAIGN_DEFINITIONS = [
  {
    id: "camp_loyalty_bundle",
    name: "AI Loyalty Pantry Restock Bundle",
    badge: "3+ Clean Orders Loyalty Perk",
    description: "Exclusive bundle for verified high-trust agents: 5 kg Aged Basmati + 1 L Mustard Oil with 15% instant loyalty discount.",
    ruleTrigger: "Agent has completed 3+ clean payment captures on active mandate.",
    minCleanPayments: 3,
    items: [
      { sku: "RICE-BAS-5KG", qty: 1 },
      { sku: "OIL-MUS-1L", qty: 1 },
    ],
    discountPercent: 15,
  },
  {
    id: "camp_welcome_starter",
    name: "Kirana AI Starter Pack",
    badge: "First-Time Buyer Welcome",
    description: "Welcome pack for newly registered AI purchasing agents: 1 kg Basmati Rice + 1 kg Toor Dal with 10% introductory savings.",
    ruleTrigger: "Agent is newly registered with 0 prior transactions.",
    minCleanPayments: 0,
    items: [
      { sku: "RICE-BAS-1KG", qty: 1 },
      { sku: "DAL-TOO-1KG", qty: 1 },
    ],
    discountPercent: 10,
  },
];

/**
 * Deterministic Campaign Orchestrator
 *
 * Evaluates active campaigns against calling agent identity, trust reputation,
 * and hash-chained audit history. Strictly enforces mandate spending ceilings.
 */
export function evaluateActiveCampaigns(params: {
  agentId: string;
  mandate: Mandate | null;
  auditHistory: AuditRecord[];
}): CampaignOffer | null {
  if (!params.mandate || params.mandate.status !== "active") return null;

  const identity = lookupAgentIdentity(params.agentId);
  const cleanPayments = params.auditHistory.filter(
    (e) => e.event === "razorpay.captured" || e.event === "merchant.order_paid",
  ).length;

  // Rule 1: High-Frequency Loyalty Bundle (3+ clean transactions or high trust >= 80)
  if (cleanPayments >= 3 || (identity && identity.trustScore >= 80 && cleanPayments >= 1)) {
    const def = CAMPAIGN_DEFINITIONS[0];
    const lines: CartLine[] = [];
    let origTotal = 0;

    for (const spec of def.items) {
      const item = getItem(spec.sku);
      if (!item || item.stock < spec.qty) return null;
      // Guardrail sanity: check brand & category
      if (params.mandate.brandsDeny.includes(item.brand)) return null;
      if (!params.mandate.categories.includes(item.category)) return null;

      const linePaise = item.pricePaise * spec.qty;
      origTotal += linePaise;
      lines.push({
        sku: item.sku,
        name: item.name,
        brand: item.brand,
        category: item.category,
        unitPricePaise: item.pricePaise,
        quantity: spec.qty,
        linePaise,
      });
    }

    const discountAmount = Math.round(origTotal * (def.discountPercent / 100));
    const discountedTotal = origTotal - discountAmount;

    // Hard constraint: Must stay within remaining mandate limit
    if (discountedTotal > params.mandate.remainingPaise) return null;

    return {
      id: def.id,
      name: def.name,
      badge: def.badge,
      description: def.description,
      ruleTrigger: def.ruleTrigger,
      originalTotalPaise: origTotal,
      discountedTotalPaise: discountedTotal,
      savingsPaise: discountAmount,
      savingsPercent: def.discountPercent,
      lines,
      withinMandateLimit: true,
    };
  }

  // Rule 2: Welcome Starter Pack for early sessions
  if (cleanPayments === 0) {
    const def = CAMPAIGN_DEFINITIONS[1];
    const lines: CartLine[] = [];
    let origTotal = 0;

    for (const spec of def.items) {
      const item = getItem(spec.sku);
      if (!item || item.stock < spec.qty) return null;
      if (params.mandate.brandsDeny.includes(item.brand)) return null;
      if (!params.mandate.categories.includes(item.category)) return null;

      const linePaise = item.pricePaise * spec.qty;
      origTotal += linePaise;
      lines.push({
        sku: item.sku,
        name: item.name,
        brand: item.brand,
        category: item.category,
        unitPricePaise: item.pricePaise,
        quantity: spec.qty,
        linePaise,
      });
    }

    const discountAmount = Math.round(origTotal * (def.discountPercent / 100));
    const discountedTotal = origTotal - discountAmount;

    if (discountedTotal > params.mandate.remainingPaise) return null;

    return {
      id: def.id,
      name: def.name,
      badge: def.badge,
      description: def.description,
      ruleTrigger: def.ruleTrigger,
      originalTotalPaise: origTotal,
      discountedTotalPaise: discountedTotal,
      savingsPaise: discountAmount,
      savingsPercent: def.discountPercent,
      lines,
      withinMandateLimit: true,
    };
  }

  return null;
}

/**
 * Converts an active campaign offer into a structured ProposedCart for checkout execution
 */
export function buildCampaignCart(offer: CampaignOffer, merchantId = MERCHANT_ID, merchantName = MERCHANT_NAME): ProposedCart {
  return {
    lines: offer.lines,
    totalPaise: offer.discountedTotalPaise,
    merchantId,
    merchantName,
    reason: `Campaign Offer Applied: ${offer.name} (${offer.savingsPercent}% loyalty savings applied).`,
  };
}
