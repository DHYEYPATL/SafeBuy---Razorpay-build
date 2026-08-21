import test from "node:test";
import assert from "node:assert/strict";
import { useSafeBuy } from "../store";

test("applyConfirm: decrements mandate remainingPaise only on valid payment", async () => {
  const store = useSafeBuy.getState();
  store.resetDemo();

  await store.createMandate({
    maxAmountPaise: 150000,
    categories: ["grains", "pulses"],
    brandsAllow: [],
    brandsDeny: [],
    maxQuantityPerItem: 3,
    priceCeilingPerItemPaise: 50000,
  });

  const mandateBefore = useSafeBuy.getState().mandate;
  assert.equal(mandateBefore?.remainingPaise, 150000);
  assert.equal(mandateBefore?.spentPaise, 0);

  // Set a pending cart
  useSafeBuy.setState({
    pendingCart: {
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
      reason: "Test purchase",
    },
  });

  // Apply confirmation via fetch
  await store.applyConfirm({
    paymentId: "pay_test_001",
    orderId: "order_test_001",
    source: "fetch",
    status: "captured",
  });

  const mandateAfter = useSafeBuy.getState().mandate;
  assert.equal(mandateAfter?.remainingPaise, 150000 - 14200);
  assert.equal(mandateAfter?.spentPaise, 14200);
  assert.equal(useSafeBuy.getState().phase, "confirmed");
});

test("applyConfirm: ignores duplicate payment IDs and prevents double-debiting", async () => {
  const store = useSafeBuy.getState();
  const balanceBefore = useSafeBuy.getState().mandate?.remainingPaise;

  // Attempt duplicate confirmation for the same paymentId
  await store.applyConfirm({
    paymentId: "pay_test_001",
    orderId: "order_test_001",
    source: "webhook",
    status: "captured",
  });

  const balanceAfter = useSafeBuy.getState().mandate?.remainingPaise;
  // Balance must remain unchanged!
  assert.equal(balanceAfter, balanceBefore);
});
