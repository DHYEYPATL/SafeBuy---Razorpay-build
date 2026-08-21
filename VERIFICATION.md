# SafeBuy — Reviewer Dry Run & Evaluation Checklist

This checklist reproduces the exact evaluation steps a Razorpay judge will perform when scoring SafeBuy for Track 01.

---

# 1. Automated Verification Gates

Execute in project root:
```bash
# 1. Typecheck: Zero compiler errors
npm run typecheck

# 2. Automated Unit Tests: 29/29 tests passing
npm run test:unit

# 3. Third-Party Agent Discovery Demonstration (Zero SafeBuy internal imports)
npx tsx scripts/external-agent-demo.ts
```

Expected Test Output:
```text
> tsx --test "src/lib/safebuy/__tests__/*.test.ts"

TAP version 13
ok 1 - applyConfirm: decrements mandate remainingPaise only on valid payment
ok 2 - applyConfirm: ignores duplicate payment IDs and prevents double-debiting
ok 3 - Guardrail: passes for compliant cart matching packTokens and budget
ok 4 - Guardrail: catches real agentic failure (same-category substitution e.g. atta for basmati)
ok 5 - Guardrail: blocks when budget exceeds remaining mandate cap
ok 6 - Guardrail: blocks on expired mandate policy
ok 7 - Guardrail: blocks on denied brand
ok 8 - Hash Chain: creates deterministic SHA-256 hashes
ok 9 - Hash Chain: validates sequential unbroken chain
ok 10 - Hash Chain: detects tampering and invalid prevHash
ok 11 - MCP: tools list contains all 6 core agent tools
ok 12 - MCP: search_catalog returns structured SKU list matching tokens
ok 13 - MCP: propose_purchase succeeds for valid intent within mandate
ok 14 - MCP: adversarial intent string cannot bypass deterministic guardrail (Edge Case 9)
ok 15 - MCP: rejects propose_purchase if mandate does not exist (cannot mint mandates)
ok 16 - MerchantOrder: initializes in reserved state with stock hold
ok 17 - PreDebitNotice: creates valid notice record with future execution threshold
ok 18 - PlanCart: picks lowest price matching SKU based on packTokens
ok 19 - PlanCart: asks clarification when budget is lower than any available SKU
ok 20 - PlanCart: respects excludeSkus during stock race recovery
ok 21 - Signature: verifies valid Razorpay Checkout HMAC signature
ok 22 - Signature: rejects forged or mismatched Checkout signature
ok 23 - Signature: verifies valid Razorpay webhook raw body signature
ok 24 - Upsell: surfaces 5kg economy pack with unit-price savings within mandate limit
ok 25 - Upsell: rejects candidate if total price exceeds remaining mandate cap
ok 26 - Upsell: rejects candidate if total price exceeds user explicit prompt budget
ok 27 - Upsell: rejects candidate if brand is denied in policy
ok 28 - x402: returns 402 challenge with valid orderId and amount
ok 29 - x402: issues short-lived token upon settlement and validates token
1..29
# tests 29, pass 29, fail 0
```

---

## 2. Reviewer Checklist Matrix

| # | Inspection Item | Verification Step | Pass Criteria |
|---|----------------|-------------------|---------------|
| 1 | **Test Credentials Guard** | Launch app without `.env` keys. | Yellow warning banner displayed; Checkout refuses to open without keys. |
| 2 | **Happy Path Spend** | Establish policy (₹1500), send `"Buy 1 kg basmati under ₹150"`. | Pre-debit notice `#not_...` issued; Razorpay Order created; Checkout opens with real `order_id`; test payment completes; status changes to `pending` then `confirmed` via Fetch. Mandate remaining drops to ₹1358. |
| 3 | **Bounded Upsell Engine** | During notice countdown for 1kg Basmati, inspect card. | Smart Unit-Price Upsell surfaces 5kg Economy Pack (12% cheaper per kg); clicking "Switch" updates pre-debit notice and merchant order. |
| 4 | **External Agent Discovery** | Run `npx tsx scripts/external-agent-demo.ts`. | External agent connects to `/.well-known/agent-catalog.json`, discovers merchant SKUs, matches tokens, and verifies machine transactability. |
| 5 | **Token-Level Guardrail** | Establish policy, send `"Buy 1 kg basmati under ₹150"`, inject Mismatch or select Cadbury. | Guardrail blocks because `basmati` token is not in candidate cart; Human Confirmation modal appears. |
| 6 | **Agent Ask-Back** | Send `"Buy 1 kg basmati under ₹50"`. | Agent asks: *"The lowest available price in grains is ₹142 (Aged Basmati Rice 1 kg). Would you like to increase your budget?"* |
| 7 | **Pre-Debit Notice Controls** | Trigger buy, click `+5s Hold/Extend` during countdown. | Notice dwell extends by 5 seconds; audit logs `notify.window_extended`. Click `Abort` releases reserved stock. |
| 8 | **Merchant Order Lifecycle** | Inspect **Orders tab** before and after payment. | Order status transitions from `RESERVED` → `PAID`. Live catalog stock decrements. |
| 9 | **AP2 Primitives Documents** | Inspect **AP2 Primitives tab**. | Three JSON schemas displayed: `AP2IntentMandate`, `AP2CartMandate`, `AP2PaymentMandate`. |
| 10 | **Cryptographic Audit Verifier** | Inspect **Audit tab**, click **"Verify Audit Chain"**. | Traverses every record from `GENESIS_HASH`; displays green banner confirming unbroken SHA-256 integrity. |
| 11 | **Idempotent Reconciliation** | Inspect store and console on duplicate callbacks. | Second callback for same `payment_id` logs `razorpay.duplicate_ignored` with zero double-debit. |
| 12 | **Soft Decline Recovery** | Select "Soft decline" in Lab, attempt payment with card `4000 0000 0000 1003`. | Fetches failed status from Razorpay; limits to 1 retry; halts cleanly. |

---

## 3. Scorecard Alignment

- **Problem Taste:** Explicitly addresses the Indian silent-debit regulatory gap via pre-debit notices and customer-present Checkout on server-created Orders.
- **Build Quality:** Real Razorpay Orders API, HMAC signature validation, status Fetch reconciliation, Webhook endpoint, and 16 automated tests.
- **AI Judgment:** Deterministic guardrail as law; LLM strictly as an intent proposer; no LLM anywhere near money movement.
- **Failure Recovery:** Real soft decline status verification, stock race next-best recovery, semantic mismatch modal, and fail-closed timeout protections.
