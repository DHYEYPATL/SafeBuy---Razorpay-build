# SafeBuy — Bounded AI Buyer for Agentic Commerce

> **Track 01: Agentic Commerce Submission (Option B)**  
> *Making merchants transactable end-to-end by a bounded AI buyer with deterministic policy guardrails and real Razorpay test-mode execution.*

SafeBuy is a bounded AI purchasing agent that enables autonomous cart planning while enforcing strict spending policies, deterministic semantic guardrails, and compliance with Indian payment regulations.

---

## 1. The Undeniable Kernel (The Money Spine)

SafeBuy is built as the **missing safety and governance layer** around autonomous AI agents:
> *"The AI Agent plans and gates; execution is customer-present hosted Checkout / Orders because test-mode silent debit without live bank e-mandate registration is not a legal Indian rail. The pre-debit notice record + dwell window is the safety gate."*

```text
Human Mandate (Policy Schema: spend cap, categories, brand boundaries)
                │
                ▼
Instruction → Structured Intent (Extracted packTokens: ['basmati'])
                │
                ▼
Planner (Catalog Match + Price Ceiling + Stock Check)
                │
                ▼
Deterministic Guardrail (Schema & Pack Token Verification: catches Atta for Basmati)
                │
                ▼
Durable PreDebitNotice + MerchantOrder Stock Reservation ('reserved' status)
                │
                ▼
Razorpay Orders API (`POST /v1/orders` → mandatory server `order_id`)
                │
                ▼
Razorpay Checkout.js (Customer Present)
                │
                ▼
Reconciliation Loop (`GET /v1/payments/:id` polling until `status === "captured"`)
                │
                ▼
Sole Mutator (`applyConfirm` decrements mandate + marks MerchantOrder 'paid')
                │
                ▼
Cryptographic SHA-256 Audit Hash Chain & Live GMV Metrics
```

---

## 2. The 5 Immutable Safety Guarantees

1. **Server Order is Mandatory:** Razorpay Checkout strictly requires an `order_id` generated via `POST /v1/orders`. Bounded buyer fails closed if credentials or order creation fail.
2. **Handler Callback ≠ Paid:** When Checkout fires the client callback, the state moves to `pending`. Mandate balance remains unchanged until backend verification succeeds.
3. **Sole State Mutator (`applyConfirm`):** Only verified `status === "captured"` responses from `GET /v1/payments/:id` trigger balance deduction and stock decrements.
4. **Idempotency & Double-Debit Protection:** Duplicate callbacks or late deliveries are recorded as `razorpay.duplicate_ignored` with zero double-debiting.
5. **Fail-Closed Release:** User abort, modal dismiss, or exhausted soft decline triggers `releaseReservation`, reverting held stock and keeping mandate spend intact.

---

## 3. Explicit Non-Goals (Depth of Judgment)

Judges evaluate what a team chooses **not** to build under real regulatory and rail constraints:

- **No Silent Debit on Indian Rails:** Headless on-demand debit without customer-present authentication or bank e-mandate registration is not legal in India. SafeBuy uses pre-debit notices and hosted Checkout.
- **No Live Visa TAP / NPCI UAP Registry Claims:** Agent identity, HMAC message signing, and trust scoring are implemented as a clean, honest reference pattern (`src/lib/safebuy/identity.ts`), not a live certified network.
- **No Multi-Merchant Scraping in v1:** Focused entirely on deep single-merchant transactability, stock reservations, and order reconciliation.
- **Live Webhook Ingress is Post-Deploy:** In-session demo settlement uses direct Fetch polling (`GET /v1/payments/:id`). Webhook HMAC validation is an offline verified module.

---

## 4. Live Core vs. Synthetic Sandbox Props

| Component | Layer | Description |
|-----------|-------|-------------|
| **Structured Intent Mandate** | **LIVE** | Hard spend limits, allowed/denied brands, categories, per-item ceilings, and validity expiry (`validUntil`). |
| **Deterministic Guardrail** | **LIVE** | Validates cart items against schema **and** `packTokens`, catching same-category substitutions (e.g. atta for basmati). |
| **Deterministic Bounded Upsell** | **LIVE** | Evaluates economy pack sizes (e.g. 5kg saving 12%/kg) bounded by remaining mandate limits. |
| **Merchant Order & Stock Reservation** | **LIVE** | Creates durable `MerchantOrder` reserving stock before notice window; settles to `paid` or releases on abort. |
| **Pre-Debit Notice Record** | **LIVE** | Creates durable `PreDebitNotice` data record with `executeAfter` timestamp and hold/extend controls. |
| **Razorpay Orders API** | **LIVE** | Real `POST /v1/orders` created before debit with receipt ID, correlation IDs, and attempt notes. |
| **In-Session Reconciliation (Primary Rail)** | **LIVE** | Backend polling (`GET /v1/payments/:id`) verifying `status === "captured"` before `applyConfirm` debits. |
| **HMAC Signature Verification** | **LIVE** | Server-side cryptographic verification of Checkout `order_id|payment_id` signatures. |
| **Hash-Chained Audit Trail** | **LIVE** | Sequential SHA-256 hash chaining with canonical JSON and interactive UI verification. |
| **Merchant Catalog (Nila Kirana)** | **SYNTHETIC** | Stand-in grocery merchant catalog providing realistic agent-readable SKUs. |
| **Bank Pre-debit SMS** | **SYNTHETIC** | Simulated in-app notice standing in for RBI 24h SMS notice. |
| **Compressed Notify Window (8s)** | **SYNTHETIC** | 8-second dwell standing in for the regulatory 24-hour notification window. |

---

## 5. Supporting & Reference Patterns (Not the Golden Demo Path)

These modules exist in the codebase to demonstrate standard agentic interfaces:

- **Machine-Readable Discovery (`/.well-known/agent-catalog.json`):** AP2/ACP-compliant public discovery manifest exposing structured SKU metadata and `packTokens` for external AI buyers (`scripts/external-agent-demo.ts`).
- **Model Context Protocol (`src/mcp/server.ts`):** Standard JSON-RPC stdio MCP server exporting 7 agent tools with outbound budget redaction (stdio tool pattern).
- **Agent Identity Reference Pattern (`src/lib/safebuy/identity.ts`):** In-memory registration, HMAC signature verification, 30s replay defense, and audit-derived trust score.
- **x402 Monetization Pattern (`src/lib/safebuy/x402.ts`):** HTTP 402 challenge/settlement module gating wholesale stock behind dynamic micro-fees paid via Razorpay Orders.
- **Offline Webhook Verifier (`src/lib/safebuy/razorpay-webhook.ts`):** Timing-safe HMAC SHA-256 validation module tested via unit test suite.

---

## 6. What Broke & What We Fixed (Postmortem)

1. **Catches Real Same-Category Agentic Substitutions:**
   - *Problem:* Category-only check allowed substituting atta for basmati because both are `grains`.
   - *Fix:* Guardrail enforces `packTokens` matching. If the user asks for `"basmati"`, any proposed cart lacking basmati tokens is blocked as a semantic mismatch.
2. **Clarification Ask-Backs Instead of Silent Drops:**
   - *Problem:* When user budget was too low (e.g. `"under ₹50"`), previous planner silently returned an empty cart.
   - *Fix:* Agent actively asks back: *"The lowest available price in grains is ₹142 (India Gate Basmati Rice 1kg). Would you like to increase your budget?"*
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

## 7. Setup & Local Execution

### Prerequisites
- Node.js 22+
- Razorpay Dashboard account in **Test Mode**

### 1. Configure Environment Variables
Create `.env` based on `.env.example`:

```bash
# Razorpay Test Credentials (Dashboard -> Settings -> API Keys)
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
```

### 2. Install & Run
```bash
# Install dependencies
npm install

# Run dev server on 0.0.0.0:8080
npm run dev

# Run TypeScript typecheck
npm run typecheck

# Run unit tests (41/41 passing)
npm run test:unit
```

### 3. Razorpay Test Cards
- **Success Test Card:** `4111 1111 1111 1111`, Expiry: future date (`12/30`), CVV: `123`, OTP: `123456`.
- **Soft Decline Card:** `4000 0000 0000 1003` (Simulates card decline to verify retry limit and zero false debits).

---

## 8. License & Hackathon Attribution
Built for the Razorpay AI Buildathon — Track 01 (Agentic Commerce).  
All safety protocols, token guardrails, mandate management, and audit verification algorithms are original implementations.
