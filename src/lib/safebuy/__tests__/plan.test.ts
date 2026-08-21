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
  revokedAt: null,
  afaSimulatedAt: new Date().toISOString(),
  afaMethod: "simulated_upi_pin",
};

test("PlanCart: picks lowest price in-mandate matching item", () => {
  const intent: StructuredIntent = {
    maxAmountPaise: 20000,
    categories: ["grains"],
    brandsAllow: [],
    brandsDeny: [],
    maxQuantityPerItem: 1,
    priceCeilingPerItemPaise: 20000,
    queryText: "Buy 1 kg basmati rice",
  };

  const cart = planCart(mockMandate, intent);
  assert.equal(cart.lines.length, 1);
  assert.equal(cart.lines[0]?.sku, "RICE-BAS-1KG");
  assert.equal(cart.totalPaise, 14200);
});

test("PlanCart: respects excludeSkus during stock race recovery", () => {
  const intent: StructuredIntent = {
    maxAmountPaise: 50000,
    categories: ["grains"],
    brandsAllow: [],
    brandsDeny: [],
    maxQuantityPerItem: 1,
    priceCeilingPerItemPaise: 50000,
    queryText: "Buy 1 kg basmati rice",
  };

  // Exclude the cheapest basmati rice SKU
  const cart = planCart(mockMandate, intent, false, ["RICE-BAS-1KG"]);
  assert.equal(cart.lines.length, 1);
  assert.notEqual(cart.lines[0]?.sku, "RICE-BAS-1KG");
});
