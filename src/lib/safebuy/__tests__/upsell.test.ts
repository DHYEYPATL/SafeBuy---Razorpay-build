import test from "node:test";
import assert from "node:assert/strict";
import { findBoundedUpsell } from "../upsell";
import type { Mandate, ProposedCart, StructuredIntent } from "../types";
import { CATALOG } from "../catalog";

const baseMandate: Mandate = {
  id: "man_test",
  status: "active",
  merchantId: "nila-kirana",
  maxAmountPaise: 100000,
  remainingPaise: 100000,
  spentPaise: 0,
  categories: ["grains"],
  brandsAllow: [],
  brandsDeny: [],
  maxQuantityPerItem: 5,
  priceCeilingPerItemPaise: 80000,
  createdAt: new Date().toISOString(),
  validUntil: new Date(Date.now() + 86400000).toISOString(),
  revokedAt: null,
  authorizedBy: "human",
  authorizationMethod: "simulated_registration_auth",
};

const baseCart: ProposedCart = {
  lines: [
    {
      sku: "RICE-BAS-1KG",
      name: "Aged Basmati Rice 1 kg",
      brand: "India Gate",
      category: "grains",
      unitPricePaise: 14200,
      quantity: 1,
      linePaise: 14200,
    },
  ],
  totalPaise: 14200,
  merchantId: "nila-kirana",
  merchantName: "Nila Kirana",
  reason: "1 kg basmati rice",
};

const baseIntent: StructuredIntent = {
  maxAmountPaise: 100000,
  categories: ["grains"],
  brandsAllow: [],
  brandsDeny: [],
  maxQuantityPerItem: null,
  priceCeilingPerItemPaise: null,
  packTokens: ["basmati"],
  excludeTokens: [],
  qty: 1,
  packSizeHint: "1kg",
  queryText: "Buy 1 kg basmati",
};

test("Upsell: surfaces 5kg economy pack with unit-price savings within mandate limit", () => {
  const candidate = findBoundedUpsell(baseCart, baseMandate, baseIntent, CATALOG);

  assert.ok(candidate);
  assert.equal(candidate.originalSku, "RICE-BAS-1KG");
  assert.equal(candidate.suggestedSku, "RICE-BAS-5KG");
  assert.equal(candidate.withinMandateLimit, true);
  assert.equal(candidate.savingsPercent, 12); // ₹142/kg vs ₹125/kg is 12% savings
  assert.equal(candidate.suggestedTotalPaise, 62500);
});

test("Upsell: rejects candidate if total price exceeds remaining mandate cap", () => {
  const tightMandate: Mandate = {
    ...baseMandate,
    remainingPaise: 30000, // Only ₹300 remaining; 5kg costs ₹625
  };

  const candidate = findBoundedUpsell(baseCart, tightMandate, baseIntent, CATALOG);
  assert.equal(candidate, null);
});

test("Upsell: rejects candidate if total price exceeds user explicit prompt budget", () => {
  const strictBudgetIntent: StructuredIntent = {
    ...baseIntent,
    maxAmountPaise: 20000, // User specifically stated 'under ₹200'
  };

  const candidate = findBoundedUpsell(baseCart, baseMandate, strictBudgetIntent, CATALOG);
  assert.equal(candidate, null);
});

test("Upsell: rejects candidate if brand is denied in policy", () => {
  const brandDenyMandate: Mandate = {
    ...baseMandate,
    brandsDeny: ["India Gate"],
  };

  const candidate = findBoundedUpsell(baseCart, brandDenyMandate, baseIntent, CATALOG);
  assert.equal(candidate, null);
});
