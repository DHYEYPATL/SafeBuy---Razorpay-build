import test from "node:test";
import assert from "node:assert/strict";
import { runGuardrail } from "../guardrail";
import type { Mandate, StructuredIntent, CartLine } from "../types";

const mockMandate: Mandate = {
  id: "man_test123",
  status: "active",
  merchantId: "nila-kirana",
  maxAmountPaise: 150000, // ₹1500
  remainingPaise: 150000,
  spentPaise: 0,
  categories: ["grains", "pulses", "oil", "dairy", "spices"],
  brandsAllow: [],
  brandsDeny: ["Cadbury"],
  maxQuantityPerItem: 3,
  priceCeilingPerItemPaise: 50000, // ₹500
  createdAt: new Date().toISOString(),
  validUntil: new Date(Date.now() + 7 * 86400000).toISOString(),
  revokedAt: null,
  authorizedBy: "human_user",
  authorizationMethod: "simulated_registration_auth",
};

const mockIntent: StructuredIntent = {
  maxAmountPaise: 15000, // ₹150
  categories: ["grains"],
  brandsAllow: [],
  brandsDeny: [],
  maxQuantityPerItem: 1,
  priceCeilingPerItemPaise: 15000,
  packTokens: ["basmati"],
  excludeTokens: [],
  qty: 1,
  packSizeHint: "1kg",
  queryText: "Buy 1 kg basmati under ₹150",
};

const riceLine: CartLine = {
  sku: "RICE-BAS-1KG",
  name: "India Gate Basmati Rice 1kg",
  brand: "India Gate",
  category: "grains",
  unitPricePaise: 13500,
  quantity: 1,
  linePaise: 13500,
};

const attaLine: CartLine = {
  sku: "ATA-WHL-5KG",
  name: "Whole Wheat Atta 5 kg",
  brand: "Aashirvaad",
  category: "grains",
  unitPricePaise: 27500,
  quantity: 1,
  linePaise: 27500,
};

test("Guardrail: passes for compliant cart matching packTokens and budget", () => {
  const res = runGuardrail({
    lines: [riceLine],
    totalPaise: 13500,
    mandate: mockMandate,
    intent: mockIntent,
  });

  assert.equal(res.ok, true);
  assert.equal(res.code, "pass");
});

test("Guardrail: catches real agentic failure (same-category substitution e.g. atta for basmati)", () => {
  // User asked for "basmati" (grains), but cart has "atta" (grains)
  const res = runGuardrail({
    lines: [attaLine],
    totalPaise: 27500,
    mandate: { ...mockMandate, maxAmountPaise: 50000, remainingPaise: 50000 },
    intent: { ...mockIntent, maxAmountPaise: 50000 },
  });

  // Guardrail must catch that "basmati" is missing from the cart!
  assert.equal(res.ok, false);
  assert.equal(res.code, "semantic_mismatch");
  assert.equal(res.needsHumanConfirm, true);
});

test("Guardrail: blocks when budget exceeds remaining mandate cap", () => {
  const res = runGuardrail({
    lines: [riceLine],
    totalPaise: 200000,
    mandate: { ...mockMandate, remainingPaise: 100000 },
    intent: mockIntent,
  });

  assert.equal(res.ok, false);
  assert.equal(res.code, "mandate_exceeded");
});

test("Guardrail: blocks on expired mandate policy", () => {
  const res = runGuardrail({
    lines: [riceLine],
    totalPaise: 13500,
    mandate: { ...mockMandate, validUntil: new Date(Date.now() - 86400000).toISOString() },
    intent: mockIntent,
  });

  assert.equal(res.ok, false);
  assert.equal(res.code, "mandate_expired");
});

test("Guardrail: blocks on denied brand", () => {
  const chocolateLine: CartLine = {
    sku: "SNK-CHO-90",
    name: "Cadbury Dairy Milk Silk 90g",
    brand: "Cadbury",
    category: "snacks",
    unitPricePaise: 9500,
    quantity: 1,
    linePaise: 9500,
  };

  const res = runGuardrail({
    lines: [chocolateLine],
    totalPaise: 9500,
    mandate: mockMandate,
    intent: mockIntent,
  });

  assert.equal(res.ok, false);
  assert.equal(res.code, "semantic_mismatch");
});
