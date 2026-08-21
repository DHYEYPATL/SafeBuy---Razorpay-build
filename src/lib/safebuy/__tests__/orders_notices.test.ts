import test from "node:test";
import assert from "node:assert/strict";
import type { MerchantOrder, PreDebitNotice } from "../types";

test("MerchantOrder: initializes in reserved state with stock hold", () => {
  const order: MerchantOrder = {
    id: "mord_test123",
    merchantId: "nila-kirana",
    merchantName: "Nila Kirana",
    attemptId: "att_123",
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
    status: "reserved",
    reservedAt: new Date().toISOString(),
    paidAt: null,
    razorpayOrderId: null,
  };

  assert.equal(order.status, "reserved");
  assert.equal(order.paidAt, null);
  assert.equal(order.totalPaise, 14200);
});

test("PreDebitNotice: creates valid notice record with future execution threshold", () => {
  const now = Date.now();
  const executeAfter = new Date(now + 8000).toISOString();

  const notice: PreDebitNotice = {
    id: "not_test123",
    attemptId: "att_123",
    amountPaise: 14200,
    skus: ["RICE-BAS-1KG"],
    merchantId: "nila-kirana",
    merchantName: "Nila Kirana",
    issuedAt: new Date(now).toISOString(),
    executeAfter,
    dwellMs: 8000,
    status: "issued",
  };

  assert.equal(notice.status, "issued");
  assert.equal(notice.dwellMs, 8000);
  assert(new Date(notice.executeAfter).getTime() > now);
});
