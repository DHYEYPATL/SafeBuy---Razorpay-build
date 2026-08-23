# SafeBuy — Bounded AI Buyer for Agentic Commerce

> **Track 01: Agentic Commerce Submission (Option B)**  
> *Making merchants transactable end-to-end by a bounded AI buyer with deterministic policy guardrails and real Razorpay test-mode execution.*

SafeBuy is a bounded AI purchasing agent that enables autonomous cart planning while enforcing strict spending policies, deterministic semantic guardrails, and compliance with Indian payment regulations.

---

## 1. The Core Philosophy & Regulatory Reality

### The Honest Architecture Framing
In India, **no payment rail permits silent, unbounded autonomous debit without e-mandate registration and pre-debit notification**.

SafeBuy is built as the **missing safety and governance layer** around autonomous AI agents:
> *"The AI Agent plans and gates; execution is customer-present hosted Checkout / Orders because test-mode silent debit without live bank e-mandate registration is not a legal Indian rail. The pre-debit notice record + dwell window is the safety gate."*

Instead of letting an LLM execute arbitrary API calls, SafeBuy wraps the buyer in a deterministic container modelled after **AP2 (Agentic Payment Protocol)** primitives:

```text
Human Spending Policy (Intent Mandate)
                │
                ▼
Autonomous Agent Cart Planning (Pack Tokens & Pack Size Hints)
                │
                ▼
Deterministic Semantic Guardrail (Schema & SKU Token Matching)
                │
                ▼
Durable Pre-Debit Notice Record & Merchant Stock Reservation (Cart Mandate)
                │
                ▼
Real Razorpay Orders API (`POST /v1/orders`) + Checkout (Payment Mandate)
                │
                ▼
Reconciliation Loop (`GET /v1/payments/:id` + Webhooks) → Settlement
```

---

## 2. Live vs. Synthetic Architecture

SafeBuy maintains a strict, transparent boundary between real production logic and synthetic sandbox props:

| Component | Layer | Description |
|-----------|-------|-------------|
| **Structured Intent Mandate** | **LIVE** | Schema-enforced hard spend limits, allowed/denied brands, categories, per-item price ceilings, and policy validity period (`validUntil`). |
| **Deterministic Guardrail** | **LIVE** | Validates cart items against policy schema **and** instruction pack tokens (`packTokens`, `excludeTokens`), catching real agentic substitution errors (e.g. atta for basmati). |
| **Deterministic Bounded Upsell** | **LIVE** | Surfaces unit-price optimization suggestions (e.g. 5kg pack saving 12%/kg) strictly bounded by remaining mandate limits and brand constraints. |
| **Machine-Readable Discovery** | **LIVE** | `/.well-known/agent-catalog.json` AP2/ACP-compliant public discovery manifest exposing structured SKU metadata and `packTokens` for external AI buyers. |
| **Model Context Protocol (MCP)** | **LIVE** | Standard JSON-RPC stdio MCP server (`src/mcp/server.ts`) exporting 7 core tools (including Campaign Orchestrator) for external AI agents (Claude Desktop, etc.) with outbound budget redaction. |
| **Agent Identity & Trust (TAP/UAP Pattern)** | **LIVE (Pattern)** | Scoped reference pattern: in-memory agent registration, HMAC message signing, 30s replay defense, and audit-derived dynamic trust score. *Not live Visa TAP or NPCI UAP directory.* |
| **x402-Pattern Monetization** | **LIVE (Pattern)** | HTTP 402 challenge/settlement module (`src/lib/safebuy/x402.ts`) gating wholesale & priority stock behind dynamic micro-fees (₹1 VIP rate for high-trust agents vs ₹2 standard) paid via Razorpay Orders. |
| **Merchant Order & Stock Reservation** | **LIVE** | Creates durable `MerchantOrder` reserving catalog inventory before the notice window; settles to `paid` or releases on abort. |
| **Pre-Debit Notice Record** | **LIVE** | Creates a durable `PreDebitNotice` record with timestamp thresholds (`executeAfter`), dwell countdown, and hold/extend controls. |
| **Razorpay Orders API** | **LIVE** | Real `POST /v1/orders` created before debit with receipt ID, correlation IDs, and attempt metadata. Checkout requires `order_id`. |
| **In-Session Reconciliation (Primary Rail)**| **LIVE** | Direct backend status polling (`GET /v1/payments/:id`). Settlement executes only when `status === "captured"`. |
| **HMAC Signature Verification** | **LIVE** | Server-side cryptographic verification of Checkout `order_id|payment_id` signatures. |
| **Webhook Validation Module** | **LIVE (Module)** | Offline timing-safe raw body HMAC SHA-256 validation module and parser (`src/lib/safebuy/razorpay-webhook.ts`) verified via automated unit test suite. |
| **Hash-Chained Audit Trail** | **LIVE** | Sequential SHA-256 hash chaining with canonical JSON and interactive UI verification. |
| **Merchant Catalog (Nila Kirana)** | **SYNTHETIC** | Stand-in grocery merchant catalog providing realistic agent-readable SKUs. |
| **Bank Pre-debit SMS** | **SYNTHETIC** | Simulated in-app notice standing in for RBI 24h SMS notice. |
| **Policy Registration Auth** | **SYNTHETIC** | Simulated policy authorization standing in for bank e-mandate registration. |
| **Compressed Notify Window (8s)** | **SYNTHETIC** | 8-second dwell standing in for the regulatory 24-hour notification window. |

---

## 3. External Third-Party Agent Discovery

SafeBuy makes merchants machine-transactable by **any** external AI buyer through standard machine discovery:

```bash
# Run the standalone third-party agent demonstration (zero internal SafeBuy imports)
npx tsx scripts/external-agent-demo.ts
```

Endpoint exposed at:
- Discovery Root: `GET http://localhost:8080/.well-known/agent-catalog.json`
- Structured SKUs: `GET http://localhost:8080/api/catalog/skus`

---

## 4. AP2 Primitive Data Models

SafeBuy structures transaction state into three distinct JSON documents modelled after Google/Visa AP2 primitives:

1. **AP2 Intent Mandate:** The human-defined policy document defining spend caps, allowed categories, denied brands, and validity expiry.
2. **AP2 Cart Mandate:** The locked SKU proposal and merchant order reservation produced after guardrail clearance.
3. **AP2 Payment Mandate:** The settlement contract linking Razorpay `order_id`, `payment_id`, notice record, and reconciliation status.

*(View live generated AP2 documents in the **AP2 Primitives** tab in the app).*

---

## 5. What Broke & What We Fixed

1. **Catches Real Same-Category Agentic Substitutions:**
   - *Problem:* Previous category-only check allowed substituting atta for basmati because both are `grains`.
   - *Fix:* Guardrail enforces `packTokens` matching. If the user asks for `"basmati"`, any proposed cart lacking basmati tokens is blocked as a semantic mismatch.
2. **Clarification Ask-Backs Instead of Silent Drops:**
   - *Problem:* When user budget was too low (e.g. `"under ₹50"`), previous planner silently gave an empty cart.
   - *Fix:* Agent actively asks back: *"The lowest available price in grains is ₹142 (Aged Basmati Rice). Would you like to increase your budget?"*
3. **Durable Pre-Debit Notice & Stock Reservation:**
   - *Problem:* Notice window was previously a CSS countdown with no underlying data contract.
   - *Fix:* Created `PreDebitNotice` and `MerchantOrder` lifecycle (`reserved` → `paid` / `released`).
4. **Checkout Without Order Bug Fixed:**
   - *Problem:* Checkout opened with a client amount only when server credentials were not bound.
   - *Fix:* Checkout strictly requires `order_id` generated via `POST /v1/orders`.
5. **Dead Fetch Status Polling Restored:**
   - *Problem:* Client handler immediately subtracted mandate spend without verifying server status.
   - *Fix:* Handler transitions state to `pending`. Polling verifies `status === "captured"` before debiting the mandate.

---

## 6. Setup & Environment Configuration

### Prerequisites
- Node.js 22+
- Razorpay Dashboard account in **Test Mode**

### 1. Configure Environment Variables
Create `.env` based on `.env.example`:

```bash
# Razorpay Test Credentials (Dashboard -> Settings -> API Keys)
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
RAZORPAY_WEBHOOK_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx

# Optional: Grok AI Intent Parser
XAI_API_KEY=
```

### 2. Install & Run Locally
```bash
# Install dependencies
npm install

# Run dev server on 0.0.0.0:8080
npm run dev

# Run TypeScript typecheck
npm run typecheck

# Run unit tests
npm run test:unit
```

### 3. Razorpay Test Cards
When Razorpay Checkout opens, use test mode credentials:
- **Success Test Card:** `4111 1111 1111 1111`, Expiry: future date (`12/30`), CVV: `123`, OTP: `123456`.
- **Soft Decline Card:** `4000 0000 0000 1003` (Returns card declined / insufficient funds to test retry cap).

### 4. Webhook Subsystem (Optional Tunnel Extension)
The webhook parser and HMAC SHA-256 verifier are fully tested in `src/lib/safebuy/__tests__/signature.test.ts`. 
- **Primary in-session demo settlement:** Real-time Fetch status polling (`GET /v1/payments/:id`).
- **External Webhook testing (optional):** Start tunnel `ngrok http 8080` and point Razorpay Dashboard webhooks to `https://<tunnel-url>/api/razorpay/webhook`.

---

## 7. Failure Lab Scenarios & Golden Utterances

Try these 1-click golden utterances in the Buy panel:
- **`"Buy 1 kg basmati under ₹150"`**: Complete happy path flow.
- **`"Get 1 kg toor dal"`**: Exact category and SKU matching.
- **`"Buy 1 kg basmati under ₹50"`**: Low budget triggering agent clarification ask-back.
- **`"Get 5 kg atta with Cadbury chocolate"`**: Deny-brand guardrail block.
- **`"Buy organic moong dal 500g"`**: Brand and pack size hint matching.

---

## 8. License & Hackathon Attribution
Built for the Razorpay AI Buildathon — Track 01 (Agentic Commerce).
All core safety protocols, guardrail enforcement, mandate management, and audit verification algorithms are original implementations.
