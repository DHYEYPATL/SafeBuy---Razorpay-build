import test from "node:test";
import assert from "node:assert/strict";
import { evaluateActiveCampaigns, buildCampaignCart } from "../campaign";
import { registerAgentIdentity } from "../identity";
import type { Mandate, AuditRecord } from "../types";

const mockMandate: Mandate = {
  id: "man_camp_test",
  status: "active",
  merchantId: "nila-kirana",
  maxAmountPaise: 150000, // ₹1,500
  remainingPaise: 150000,
  spentPaise: 0,
  categories: ["grains", "pulses", "oil", "dairy", "spices", "snacks", "beverages", "household"],
  brandsAllow: [],
  brandsDeny: ["Cadbury"],
  maxQuantityPerItem: 5,
  priceCeilingPerItemPaise: 100000,
  createdAt: new Date().toISOString(),
  validUntil: new Date(Date.now() + 7 * 86400000).toISOString(),
  revokedAt: null,
  authorizedBy: "human_test_user",
  authorizationMethod: "simulated_registration_auth",
};

test("Campaign: surfaces Welcome Starter Pack for newly registered agent with 0 transactions", () => {
  const newAgent = registerAgentIdentity({
    publicKey: "pub_ed25519_new_buyer",
    operatorName: "New Autonomous Buyer",
  });

  const offer = evaluateActiveCampaigns({
    agentId: newAgent.agentId,
    mandate: mockMandate,
    auditHistory: [], // 0 transactions
  });

  assert.ok(offer);
  assert.equal(offer.id, "camp_welcome_starter");
  assert.equal(offer.savingsPercent, 10);
  assert.ok(offer.discountedTotalPaise < offer.originalTotalPaise);
  assert.ok(offer.lines.length >= 2);
});

test("Campaign: surfaces Loyalty Restock Bundle with 15% discount for returning agent with 3+ clean payments", () => {
  const returningAgent = registerAgentIdentity({
    publicKey: "pub_ed25519_loyal_buyer",
    operatorName: "Loyal Autonomous Buyer",
  });

  const cleanAudit: AuditRecord[] = [
    {
      seq: 1,
      id: "aud_1",
      ts: new Date().toISOString(),
      correlationId: "cor_1",
      phase: "confirmed",
      event: "razorpay.captured",
      layer: "live",
      explain: "Payment 1",
      payload: {},
      hash: "h1",
      prevHash: "genesis",
    },
    {
      seq: 2,
      id: "aud_2",
      ts: new Date().toISOString(),
      correlationId: "cor_2",
      phase: "confirmed",
      event: "razorpay.captured",
      layer: "live",
      explain: "Payment 2",
      payload: {},
      hash: "h2",
      prevHash: "h1",
    },
    {
      seq: 3,
      id: "aud_3",
      ts: new Date().toISOString(),
      correlationId: "cor_3",
      phase: "confirmed",
      event: "razorpay.captured",
      layer: "live",
      explain: "Payment 3",
      payload: {},
      hash: "h3",
      prevHash: "h2",
    },
  ];

  const offer = evaluateActiveCampaigns({
    agentId: returningAgent.agentId,
    mandate: mockMandate,
    auditHistory: cleanAudit,
  });

  assert.ok(offer);
  assert.equal(offer.id, "camp_loyalty_bundle");
  assert.equal(offer.savingsPercent, 15);
  assert.ok(offer.discountedTotalPaise <= mockMandate.remainingPaise);

  const cart = buildCampaignCart(offer);
  assert.equal(cart.totalPaise, offer.discountedTotalPaise);
  assert.ok(cart.reason.includes("Campaign Offer Applied"));
});

test("Campaign: rejects candidate if total price exceeds remaining mandate cap", () => {
  const returningAgent = registerAgentIdentity({
    publicKey: "pub_ed25519_broke_buyer",
    operatorName: "Low Budget Buyer",
  });

  const tinyBudgetMandate: Mandate = {
    ...mockMandate,
    maxAmountPaise: 5000,
    remainingPaise: 3000, // ₹30 only (bundle costs > ₹500)
  };

  const offer = evaluateActiveCampaigns({
    agentId: returningAgent.agentId,
    mandate: tinyBudgetMandate,
    auditHistory: [],
  });

  assert.equal(offer, null);
});
