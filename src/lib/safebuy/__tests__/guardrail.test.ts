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
  revokedAt: null,
  afaSimulatedAt: new Date().toISOString(),
  afaMethod: "simulated_upi_pin",
};

const mockIntent: StructuredIntent = {
  maxAmountPaise: 15000, // ₹150
  categories: ["grains"],
  brandsAllow: [],
  brandsDeny: [],
  maxQuantityPerItem: 1,
  priceCeilingPerItemPaise: 15000,
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

test("Guardrail: passes for compliant cart within mandate and intent", () => {
  const res = runGuardrail({
    lines: [riceLine],
    totalPaise: 13500,
    mandate: mockMandate,
    intent: mockIntent,
  });

  assert.equal(res.ok, true);
  assert.equal(res.code, "pass");
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

test("Guardrail: blocks on revoked mandate", () => {
  const res = runGuardrail({
    lines: [riceLine],
    totalPaise: 13500,
    mandate: { ...mockMandate, status: "revoked" },
    intent: mockIntent,
  });

  assert.equal(res.ok, false);
  assert.equal(res.code, "mandate_revoked");
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

test("Guardrail: flags needsHumanConfirm when above ₹15,000 AFA threshold", () => {
  const expensiveLine: CartLine = {
    ...riceLine,
    unitPricePaise: 1600000,
    linePaise: 1600000,
  };

  const res = runGuardrail({
    lines: [expensiveLine],
    totalPaise: 1600000,
    mandate: { ...mockMandate, maxAmountPaise: 2000000, remainingPaise: 2000000 },
    intent: { ...mockIntent, maxAmountPaise: 2000000 },
  });

  assert.equal(res.ok, false);
  assert.equal(res.code, "afa_threshold");
  assert.equal(res.needsHumanConfirm, true);
});
