# SafeBuy — Reviewer Dry Run & Evaluation Checklist

This checklist reproduces the exact evaluation steps a Razorpay judge will perform when scoring SafeBuy for Track 01.

---

# 1. Automated Verification Gates

Execute in project root:
```bash
# 1. Typecheck: Zero compiler errors
npm run typecheck

# 2. Automated Unit Tests: 40/40 tests passing
npm run test:unit

# 3. Third-Party Agent Discovery Demonstration (Zero SafeBuy internal imports)
npx tsx scripts/external-agent-demo.ts
```

Expected Test Output:
```text
> tsx --test "src/lib/safebuy/__tests__/*.test.ts"

TAP version 13
ok 1 - Campaign: surfaces Welcome Starter Pack for newly registered agent with 0 transactions
ok 2 - Campaign: surfaces Loyalty Restock Bundle with 15% discount for returning agent with 3+ clean payments
ok 3 - Campaign: rejects candidate if total price exceeds remaining mandate cap
ok 4 - applyConfirm: decrements mandate remainingPaise only on valid payment
ok 5 - applyConfirm: ignores duplicate payment IDs and prevents double-debiting
ok 6 - Guardrail: passes for compliant cart matching packTokens and budget
ok 7 - Guardrail: catches real agentic failure (same-category substitution e.g. atta for basmati)
ok 8 - Guardrail: blocks when budget exceeds remaining mandate cap
ok 9 - Guardrail: blocks on expired mandate policy
ok 10 - Guardrail: blocks on denied brand
ok 11 - Hash Chain: creates deterministic SHA-256 hashes
ok 12 - Hash Chain: validates sequential unbroken chain
ok 13 - Hash Chain: detects tampering and invalid prevHash
ok 14 - Identity: registers new agent identity with public key and initial trust score
ok 15 - Identity: verifies valid signed message and rejects forged signature (Edge Case 10)
ok 16 - Identity: computes derived trust score from audit history
ok 17 - Identity: outbound payload redaction never leaks private mandate ceilings (Edge Case 13)
ok 18 - Identity: mitigates trust-score gaming via volume dampening (Edge Case 11)
ok 19 - Identity: enforces actingFor accountability chain across delegated sub-agents (Edge Case 12)
ok 20 - Identity: unregistered agent or signature failure fails closed with zero debit (Edge Case 14)
ok 21 - MCP: tools list contains all core agent tools including campaign orchestrator
ok 22 - MCP: search_catalog returns structured SKU list matching tokens
ok 23 - MCP: propose_purchase succeeds for valid intent within mandate
ok 24 - MCP: get_active_campaigns returns valid active campaign bundle for mandate
ok 25 - MCP: adversarial intent string cannot bypass deterministic guardrail (Edge Case 9)
ok 26 - MCP: rejects propose_purchase if mandate does not exist (cannot mint mandates)
ok 27 - MerchantOrder: initializes in reserved state with stock hold
ok 28 - PreDebitNotice: creates valid notice record with future execution threshold
ok 29 - PlanCart: picks lowest price matching SKU based on packTokens
ok 30 - PlanCart: asks clarification when budget is lower than any available SKU
ok 31 - PlanCart: respects excludeSkus during stock race recovery
ok 32 - Signature: verifies valid Razorpay Checkout HMAC signature
ok 33 - Signature: rejects forged or mismatched Checkout signature
ok 34 - Signature: verifies valid Razorpay webhook raw body signature
ok 35 - Upsell: surfaces 5kg economy pack with unit-price savings within mandate limit
ok 36 - Upsell: rejects candidate if total price exceeds remaining mandate cap
ok 37 - Upsell: rejects candidate if total price exceeds user explicit prompt budget
ok 38 - Upsell: rejects candidate if brand is denied in policy
ok 39 - x402: returns 402 challenge with valid orderId and amount
ok 40 - x402: issues short-lived token upon settlement and validates token
1..40
# tests 40, pass 40, fail 0
```

---

## 2. Reviewer Checklist Matrix

| # | Inspection Item | Verification Step | Pass Criteria |
|---|----------------|-------------------|---------------|
| 1 | **Test Credentials Guard** | Launch app without `.env` keys. | Yellow warning banner displayed; Checkout refuses to open without keys. |
| 2 | **Happy Path Spend** | Establish policy (₹1500), send `"Buy 1 kg basmati under ₹150"`. | Pre-debit notice `#not_...` issued with dynamic dwell (3s for high-trust agent vs 8s for new agent); Razorpay Order created; Checkout opens with real `order_id`; test payment completes; status changes to `pending` then `confirmed` via Fetch. Mandate remaining drops to ₹1358. |
| 3 | **Campaign Orchestrator** | Establish policy or complete 3 orders, inspect Buy panel banner. | Active AI Campaign surfaces Pantry Restock Bundle (15% loyalty off) or Starter Pack; clicking "Claim Bundle" instantly issues pre-debit notice with bundle discount. |
| 4 | **Agent Registry & Trust Score** | Open **Agents tab** in navigation. | Live registry displays active agents, cryptographic keys, `actingFor` delegation chain, dynamic trust score meter (0-100), and reputation-derived x402 VIP pricing tier. Sub-agents can be registered dynamically. |
| 5 | **Simulate Replay Attack (Edge Case 10)** | Select "Replay / Forgery Attack" in Lab, send instruction. | Injects forged HMAC signature; security guardrail instantly rejects proposal with `identity.signature_verification_failed` and zero financial debit (fail-closed). |
| 6 | **Bounded Upsell Engine** | During notice countdown for 1kg Basmati, inspect card. | Smart Unit-Price Upsell surfaces 5kg Economy Pack (12% cheaper per kg); clicking "Switch" updates pre-debit notice and merchant order. |
| 7 | **External Agent Discovery** | Run `npx tsx scripts/external-agent-demo.ts`. | External agent connects to `/.well-known/agent-catalog.json`, discovers merchant SKUs, matches tokens, and verifies machine transactability. |
| 8 | **Token-Level Guardrail** | Establish policy, send `"Buy 1 kg basmati under ₹150"`, inject Mismatch or select Cadbury. | Guardrail blocks because `basmati` token is not in candidate cart; Human Confirmation modal appears. |
| 9 | **Agent Ask-Back** | Send `"Buy 1 kg basmati under ₹50"`. | Agent asks: *"The lowest available price in grains is ₹142 (Aged Basmati Rice 1 kg). Would you like to increase your budget?"* |
| 10 | **Pre-Debit Notice Controls** | Trigger buy, click `+5s Hold/Extend` during countdown. | Notice dwell extends by 5 seconds; audit logs `notify.window_extended`. Click `Abort` releases reserved stock. |
| 11 | **Merchant Order Lifecycle** | Inspect **Orders tab** before and after payment. | Order status transitions from `RESERVED` → `PAID`. Live catalog stock decrements. |
| 12 | **AP2 Primitives Documents** | Inspect **AP2 Primitives tab**. | Three JSON schemas displayed: `AP2IntentMandate`, `AP2CartMandate`, `AP2PaymentMandate`. |
| 13 | **Cryptographic Audit Verifier** | Inspect **Audit tab**, click **"Verify Audit Chain"**. | Traverses every record from `GENESIS_HASH`; displays green banner confirming unbroken SHA-256 integrity. |
| 14 | **Idempotent Reconciliation** | Inspect store and console on duplicate callbacks. | Second callback for same `payment_id` logs `razorpay.duplicate_ignored` with zero double-debit. |
| 15 | **Soft Decline Recovery** | Select "Soft decline" in Lab, attempt payment with card `4000 0000 0000 1003`. | Fetches failed status from Razorpay; limits to 1 retry; halts cleanly. |

---

## 3. Scorecard Alignment

- **Problem Taste:** Explicitly addresses the Indian silent-debit regulatory gap via pre-debit notices and customer-present Checkout on server-created Orders.
- **Build Quality:** Real Razorpay Orders API, HMAC signature validation, status Fetch reconciliation, Webhook endpoint, and 40 automated tests across 7 test suites.
- **AI Judgment:** Deterministic guardrail as law; LLM strictly as an intent proposer; no LLM anywhere near money movement.
- **Failure Recovery:** Real soft decline status verification, stock race next-best recovery, semantic mismatch modal, replay attack defense, and fail-closed timeout protections.
