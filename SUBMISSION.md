# SafeBuy — Official Track 01 Submission Packet

> **Track:** 01 — Agentic Commerce  
> **Project Name:** SafeBuy — Bounded AI Buyer with Deterministic Guardrails & Razorpay Test-Mode Orders  
> **Repository:** https://github.com/DHYEYPATL/SafeBuy---Razorpay-build  
> **Option:** Option B (Making Merchants Transactable by an AI Buyer)

---

## 1. What problem does your project solve?
Autonomous AI agents are emerging to handle grocery and retail purchasing, but no payment rail in India allows silent, unbounded autonomous debit without e-mandate registration and 24-hour pre-debit notifications. Allowing an LLM to call payment APIs directly introduces severe financial risks (hallucinations, prompt injections, and budget overruns). SafeBuy provides the deterministic safety and governance layer that wraps the agent: schema-enforced spending policies, token-level guardrails, durable pre-debit notice records with dwell windows, merchant inventory reservation, and real Razorpay test-mode Order execution with reconciliation.

---

## 2. How did you make the merchant transactable end-to-end?
We built a dual-layer commerce and payment spine:
1. **Merchant Order Lifecycle:** When the guardrail approves a cart, SafeBuy creates a durable `MerchantOrder` with status `reserved`, decrementing available stock before the notice window.
2. **Pre-Debit Notice Record:** SafeBuy issues a `PreDebitNotice` with an `executeAfter` timestamp.
3. **Razorpay Orders API:** Our server creates an Order via `POST /v1/orders` passing receipt and attempt correlation IDs in notes.
4. **Hosted Checkout:** Checkout opens strictly with the server-generated `order_id`.
5. **Reconciliation & Settlement:** Client handler enters a `pending` state; backend status polling (`GET /v1/payments/:id`) and Webhooks verify `captured` status before `applyConfirm` debits the policy cap and marks the `MerchantOrder` as `paid`.

---

## 3. What is LIVE vs. what is SYNTHETIC?
- **LIVE (Real Code & Real APIs):**
  - Spending Policy Schema & validity checks.
  - Token-level Deterministic Guardrail (`packTokens`, `excludeTokens`, brand limits, price ceilings).
  - Deterministic Bounded Upsell Engine (unit-price optimization suggestions strictly bounded by policy limits).
  - AP2/ACP-compliant Machine Discovery Endpoint (`GET /.well-known/agent-catalog.json` and `GET /api/catalog/skus`).
  - Model Context Protocol (MCP) Stdio Tool (`src/mcp/server.ts`) exporting 7 standard agent tools with outbound budget redaction (stdio tool pattern, not a hosted network product).
  - Agent Identity & Trust Reputation Reference Pattern (`src/lib/safebuy/identity.ts`) with HMAC message signing, 30s replay window, and audit-derived trust scoring (*disclosed: reference pattern, not live Visa TAP directory or NPCI UAP registry*).
  - x402-Pattern Monetization Module (`src/lib/safebuy/x402.ts`) generating HTTP 402 challenge schemas and session-bound tokens (reference pattern, not a live network product).
  - Standalone External Third-Party Agent Script (`scripts/external-agent-demo.ts`).
  - Razorpay Orders API (`POST /v1/orders`) with idempotency headers.
  - Razorpay Checkout.js with mandatory `order_id`.
  - Backend Payment Status Polling (`GET /v1/payments/:id`) as the primary settlement path.
  - Offline Webhook HMAC SHA-256 validation module and test suite (`src/lib/safebuy/razorpay-webhook.ts`) (live HTTP webhook ingress is not in repo / post-deploy).
  - Server-side HMAC-SHA256 signature verification.
  - Single `applyConfirm` mutator with `confirmedPaymentIds` deduplication.
  - Cryptographic SHA-256 hash-chained audit trail with verification tool.
  - `MerchantOrder` reservation lifecycle (`reserved` → `paid` / `released`).
- **SYNTHETIC (Labelled Sandbox Props):**
  - *Nila Kirana* grocery catalog (stand-in SKUs for agent discovery).
  - Bank pre-debit SMS (simulated in-app notice).
  - Policy registration authentication (simulated consent standing in for bank e-mandate registration).
  - 8-second dwell countdown (compressed demo representation of 24h RBI window).

---

## 4. How did you handle Indian regulatory requirements (RBI / NPCI)?
Indian regulations forbid silent debits for un-registered recurring mandates and require AFA authentication during setup plus 24-hour pre-debit notifications before charge. We address this directly:
1. Setup creates a spending policy pre-authorized by human consent.
2. Every purchase creates a durable `PreDebitNotice` record with an 8s dwell window, allowing the cardholder to inspect items, hold/extend time, or abort before funds move.
3. Transactions exceeding ₹15,000 trigger mandatory AFA re-confirmation.

---

## 5. How is your project modelled after emerging standards like AP2 / UAP?
SafeBuy models transaction state into three distinct JSON documents modelled after Google/Visa AP2 primitives:
1. **AP2 Intent Mandate:** The human spending policy defining budget, categories, brand boundaries, and expiration.
2. **AP2 Cart Mandate:** The locked SKU proposal, merchant order reservation, and guardrail proof.
3. **AP2 Payment Mandate:** The settlement contract linking Razorpay `order_id`, `payment_id`, notice ID, and capture status.

---

## 6. What broke and what architectural debt did you fix? (Honest Postmortem)
1. **Checkout-Without-Order Bug:** Initially, Checkout could open with a client-supplied amount without creating a server Order. We refactored `openRazorpayCheckout` to make `orderId` mandatory and fail-closed if `createRazorpayOrder` fails.
2. **Client-Side Confirmation Vulnerability:** Initially, the client handler immediately subtracted mandate balance without server status check. We moved confirmation into a backend reconciliation loop (`GET /v1/payments/:id` + Webhook) where only `status === "captured"` can trigger `applyConfirm`.
3. **Missing Signature Validation:** We implemented timing-safe server-side `HMAC_SHA256(order_id + "|" + payment_id, KEY_SECRET)` verification.
4. **Category-Only Guardrail Miss:** Category matching alone allowed substituting atta for basmati (both `grains`). We extended `StructuredIntent` with `packTokens` and added token verification in `guardrail.ts` to catch same-category agentic substitutions.
5. **Dumb Countdown vs. Data Gate:** We transformed the CSS countdown into a durable `PreDebitNotice` data record that must be verified before payment execution.
6. **Fake UPI PIN Pad:** Replaced the hardcoded PIN 1234 with policy registration consent with configurable validity.

---

## 7. How does the agent recover from edge-case failures?
1. **Soft Decline:** Verifies payment status via Razorpay Fetch API before retrying, enforcing a strict 1-retry limit before halting cleanly.
2. **Stock Race:** If inventory drops to 0 after discovery, the planner dynamically excludes the unavailable SKU, finds the next-best in-mandate alternative, and passes it through the guardrail.
3. **Semantic Mismatch:** If an item deviates from user tokens, the guardrail halts execution and surfaces a Human Override Confirmation modal.
4. **Late Webhook Capture:** If a payment captures after a client timeout/dismiss, `applyConfirm` safely reconciles the transaction without double-spending.

---

## 8. What AI judgment was applied (where did you NOT use an LLM)?
We explicitly did NOT use an LLM for:
- Payment execution or money movement.
- Spending limits and budget checking.
- Cart safety and brand deny-list enforcement.
- Cryptographic hash chaining.
- Payment reconciliation and state mutation.
LLMs (Grok / heuristic parser) are used **strictly as proposers** to convert natural language into structured JSON (`StructuredIntent`). The deterministic TypeScript guardrail is the **uncompromising law** that governs safety.

---

## 9. What automated test coverage is implemented?
40 automated unit tests (`npm run test:unit`) across 7 test suites testing:
- Token-level guardrail checks (preventing same-category substitutions like atta for basmati).
- Mandate expiration and budget exhaustion blocks.
- Deny-brand and ₹15,000 AFA threshold enforcement.
- SHA-256 hash chaining and tamper detection.
- Merchant order reservation lifecycle and dynamic pre-debit notice dwell thresholds.
- Agent Identity & cryptographic TAP/UAP signature verification (Edge Case 10: replay defense, Edge Case 11: volume dampening, Edge Case 12: `actingFor` accountability, Edge Case 13: budget cap redaction, Edge Case 14: fail-closed on unknown agent).
- Campaign Orchestrator rules: returning buyer loyalty bundles (15% off) and first-time buyer starter packs.
- x402-pattern HTTP 402 challenge schemas, dynamic reputation pricing tiers, and token settlement.
- Model Context Protocol (MCP) tool handlers for external AI buyers.
- Ask-back clarification generation for low budgets.
- Timing-safe HMAC SHA-256 signature verification for Checkout and Webhooks.

---

## 10. How do you ensure payment idempotency?
- Orders are created with unique `Idempotency-Key` headers.
- The state orchestrator maintains a `confirmedPaymentIds` tracking table.
- `applyConfirm` is the sole mutator: duplicate Webhook deliveries or Checkout callbacks are audited as `razorpay.duplicate_ignored` and discarded without double-debiting.

---

## 11. What are the non-goals & recognized future work?
- **Spontaneous On-Demand Silent Debit Non-Goal:** We do not claim silent, zero-human autonomous debit for spontaneous on-demand purchases on Indian rails, because RBI/NPCI regulations require customer-present AFA or pre-debit notifications before funds can be charged.
- **Recognized-but-Deferred Legal Rail (Future Work):** The single Indian rail scenario where genuine silent debit *is* legally supportable today is a truly recurring, schedule-based low-value replenishment (e.g. weekly atta restock) via UPI Autopay / e-mandates, since that is schedule-based-with-notice by design; we explicitly scoped this out in favor of the harder, more immediate problem of on-demand conversational agentic commerce.
- We do not implement speculative multi-merchant web scraping or proprietary crypto tokens.
- We focus exclusively on Option B: making merchants transactable by AI buyers with verified Razorpay test-mode execution.

---

## 12. Instructions for running locally
```bash
# 1. Clone repository
git clone https://github.com/DHYEYPATL/SafeBuy---Razorpay-build.git
cd SafeBuy---Razorpay-build

# 2. Configure environment
cp .env.example .env
# Add your RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET

# 3. Install and run
npm install
npm run dev
# Open http://localhost:8080

# 4. Run verification tests
npm run typecheck
npm run test:unit
```
