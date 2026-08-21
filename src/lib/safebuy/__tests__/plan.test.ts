import test from "node:test";
import assert from "node:assert/strict";
import { planCart } from "../plan";
import type { Mandate, StructuredIntent } from "../types";

const mockMandate: Mandate = {
  id: "man_test123",
  status: "active",
  merchantId: "nila-kirana",
  maxAmountPaise: 150000, // ₹1500
  remainingPaise: 150000,
  spentPaise: 0,
  categories: ["grains", "pulses", "oil", "dairy", "spices"],
  brandsAllow: [],
  brandsDeny: [],
  maxQuantityPerItem: 3,
  priceCeilingPerItemPaise: 50000,
  createdAt: new Date().toISOString(),
  validUntil: new Date(Date.now() + 7 * 86400000).toISOString(),
  revokedAt: null,
  authorizedBy: "human_user",
  authorizationMethod: "simulated_registration_auth",
};

test("PlanCart: picks lowest price matching SKU based on packTokens", () => {
  const intent: StructuredIntent = {
    maxAmountPaise: 20000,
    categories: ["grains"],
    brandsAllow: [],
    brandsDeny: [],
    maxQuantityPerItem: 1,
    priceCeilingPerItemPaise: 20000,
    packTokens: ["basmati"],
    excludeTokens: [],
    qty: 1,
    packSizeHint: "1kg",
    queryText: "Buy 1 kg basmati rice",
  };

  const cart = planCart(mockMandate, intent);
  assert.equal(cart.lines.length, 1);
  assert.equal(cart.lines[0]?.sku, "RICE-BAS-1KG");
  assert.equal(cart.totalPaise, 14200);
});

test("PlanCart: asks clarification when budget is lower than any available SKU", () => {
  const intent: StructuredIntent = {
    maxAmountPaise: 5000, // ₹50 (no basmati or grains exist below ₹50)
    categories: ["grains"],
    brandsAllow: [],
    brandsDeny: [],
    maxQuantityPerItem: 1,
    priceCeilingPerItemPaise: 5000,
    packTokens: ["basmati"],
    excludeTokens: [],
    qty: 1,
    packSizeHint: "1kg",
    queryText: "Buy 1 kg basmati under ₹50",
  };

  const cart = planCart(mockMandate, intent);
  assert.equal(cart.lines.length, 0);
  assert.equal(cart.needsClarification, true);
  assert.match(cart.clarificationPrompt || "", /increase your budget/i);
});

test("PlanCart: respects excludeSkus during stock race recovery", () => {
  const intent: StructuredIntent = {
    maxAmountPaise: 50000,
    categories: ["grains"],
    brandsAllow: [],
    brandsDeny: [],
    maxQuantityPerItem: 1,
    priceCeilingPerItemPaise: 50000,
    packTokens: ["rice"],
    excludeTokens: [],
    qty: 1,
    packSizeHint: null,
    queryText: "Buy rice",
  };

  const cart = planCart(mockMandate, intent, false, ["RICE-BAS-1KG"]);
  assert.equal(cart.lines.length, 1);
  assert.notEqual(cart.lines[0]?.sku, "RICE-BAS-1KG");
});
