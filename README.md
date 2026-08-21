# SafeBuy — Bounded AI Buyer for Agentic Commerce

> **Track 01: Agentic Commerce Submission (Option B)**  
> *Making merchants transactable end-to-end by an autonomous AI buyer using real Razorpay test-mode APIs.*

SafeBuy is a bounded AI purchasing agent that enables autonomous grocery shopping while guaranteeing human oversight, budget safety, and compliance with Indian payment regulations.

---

## 1. Problem & Regulatory Context (The UAP / AP2 Gap)

In India, **no payment rail permits silent, unbounded autonomous debit**. RBI e-mandate guidelines require human authentication (AFA) during registration and explicit pre-debit notification before recurring charges.

While future standards like NPCI UAP (Unified Agent Protocol) and Google/Visa AP2 evolve, **SafeBuy provides the practical product answer today**:
1. **Structured Intent Mandate** authenticated at setup.
2. **Deterministic Semantic Guardrail** verifying cart items against machine-readable policy before funds move.
3. **Notify-then-Execute Gate** providing a pre-debit window for cancellation before any payment API is called.
4. **Real Razorpay Test-Mode Execution** creating Orders, handling Checkout HMAC signatures, and confirming status via backend Fetch polling & Webhooks.
5. **Hash-Chained Append-Only Audit Trail** cryptographically guaranteeing accountability.

---

## 2. Live vs. Synthetic Architecture

SafeBuy maintains a strict, transparent boundary between real production logic and synthetic sandbox props:

| Component | Layer | Description |
|-----------|-------|-------------|
| **Structured Intent Mandate** | **LIVE** | Schema-enforced hard spend limits, allowed/denied brands, category boundaries, and per-item price ceilings. |
| **Deterministic Guardrail** | **LIVE** | Diffs cart proposals against the structured mandate before initiating payments. |
| **Razorpay Orders API** | **LIVE** | Real `POST /v1/orders` created before debit with receipt ID, idempotency keys, and attempt metadata. |
| **Reconciliation Spine** | **LIVE** | Backend polling of `GET /v1/payments/:id` + Webhook HMAC verification. Mandate decrements only on `captured`. |
| **HMAC Signature Verification** | **LIVE** | Server-side cryptographic verification of Checkout `order_id|payment_id` and Webhook payloads. |
| **Hash-Chained Audit Trail** | **LIVE** | Sequential SHA-256 hash chaining with canonical JSON and UI cryptographic verification. |
| **Merchant Catalog (Nila Kirana)** | **SYNTHETIC** | Stand-in grocery merchant catalog providing realistic agent-readable SKUs. |
| **Bank Pre-debit SMS** | **SYNTHETIC** | Simulated in-app notice standing in for RBI 24h SMS notice. |
| **Registration AFA PIN (1234)** | **SYNTHETIC** | Simulated registration authentication standing in for bank UPI/card AFA. |
| **Compressed Notify Window (5s)** | **SYNTHETIC** | 5-second countdown standing in for the regulatory 24-hour notification window. |

---

## 3. What Broke & What We Fixed (Architectural Debt Elimination)

1. **Checkout Without Order Bug Fixed:**
   - *Previous state:* Checkout opened with a client amount only; no server Order was created when secret keys were absent.
   - *Fix:* Execution strictly gates behind `POST /v1/orders`. Checkout strictly requires `order_id` and fails closed if Order creation fails.
2. **Dead Fetch Status Polling Restored:**
   - *Previous state:* Client handler immediately subtracted mandate spend without verifying server status.
   - *Fix:* Handler transitions state to `pending`. Unified `startReconcile` polls `GET /v1/payments/:id` (N=6, 2s interval). Mandate `remainingPaise` decrements **only when status === captured**.
3. **HMAC Signature Validation Added:**
   - *Previous state:* `razorpay_signature` was discarded in the browser.
   - *Fix:* Server verifies `HMAC_SHA256(order_id + "|" + payment_id, RAZORPAY_KEY_SECRET)` with timing-safe comparison.
4. **Idempotency & Late Capture Reconciliation:**
   - *Previous state:* Duplicate webhook/handler calls could double-debit.
   - *Fix:* Global `confirmedPaymentIds` deduplication map. Late captures arriving after a client timeout safely reconcile without double-debiting.
5. **Real Soft Decline & Stock Race Recoveries:**
   - *Previous state:* Lab injects bypassed the payment stack with instant UI shortcuts.
   - *Fix:* Soft decline executes real status verification and enforces a strict 1-retry cap. Stock race detects zero inventory and automatically plans next-best in-mandate SKU through the guardrail.

---

## 4. Setup & Environment Configuration

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

# Run typecheck
npm run typecheck

# Run unit tests
npm run test:unit
```

### 3. Test Card Credentials
When Razorpay Checkout opens, use test mode credentials:
- **Card Number:** `4111 1111 1111 1111`
- **Expiry:** Any future date (e.g. `12/30`)
- **CVV:** Any 3 digits (e.g. `123`)
- **OTP:** Any 4/6 digits (e.g. `123456`)

### 4. Webhook Tunnel Setup (Optional for Webhooks)
To receive live Razorpay Webhooks on your local machine:
1. Start tunnel: `ngrok http 8080` or `cloudflared tunnel --url http://localhost:8080`
2. In Razorpay Dashboard -> Settings -> Webhooks, add endpoint:
   `https://<your-tunnel-url>/api/razorpay/webhook`
3. Select events:
   - `payment.captured`
   - `payment.failed`
   - `order.paid`
4. Set Webhook Secret in dashboard and add to your `.env` as `RAZORPAY_WEBHOOK_SECRET`.

---

## 5. User Walkthrough & Failure Lab Scenarios

1. **Happy Path:**
   - Create Mandate (PIN: `1234`).
   - In Buy panel, send: *"Buy 1 kg basmati under ₹150"*.
   - View 5s notify countdown (pre-debit notice).
   - Real Razorpay test Checkout opens with generated `order_id`.
   - Complete payment with test card.
   - Status verified via Fetch/Webhook; mandate balance decrements accurately; audit hash chained.
2. **Semantic Mismatch Lab:**
   - Select "LLM mismatch" in Lab tab.
   - Send: *"Buy 1 kg rice"*.
   - Agent proposes chocolate; Guardrail detects category mismatch and surfaces Human Override Confirmation modal.
3. **Stock Race Recovery Lab:**
   - Select "Stock race" in Lab tab.
   - Initial basmati SKU stock drops to 0; Agent automatically discovers next-best in-mandate rice SKU and continues through the guardrail.
4. **Soft Decline & Retry Cap Lab:**
   - Select "Soft decline" in Lab tab.
   - Status fetch reports failure; system caps retry at 1 attempt and halts without multiple charges.
5. **Cryptographic Audit Verification:**
   - Navigate to Audit tab and click **"Verify Audit Chain"**.
   - System traverses every record from `GENESIS_HASH`, re-computing SHA-256 signatures to prove zero tampering.

---

## 6. Architecture Sequence Diagram

```text
User Instruction ──► Structured Intent Parser (Grok / Deterministic)
                               │
                               ▼
                   Cart Planner (Catalog + Live Stock)
                               │
                               ▼
                   Deterministic Guardrail (Mandate Rules)
                               │
               ┌───────────────┴───────────────┐
             [Pass]                         [Mismatch / AFA > 15k]
               │                                       │
               ▼                                       ▼
    5s Pre-Debit Window (Simulated)         Human Confirmation Modal
               │                                       │
               ▼                                       ▼
     POST /v1/orders (Razorpay) ───────────► User Approved Override
               │
               ▼
     Open Checkout (order_id)
               │
               ▼
       phase = pending ◄── (Handler returns IDs & HMAC Signature)
               │
       ┌───────┴───────┐
       ▼               ▼
  GET /v1/payments   Webhook (POST /api/razorpay/webhook)
       │               │
       └───────┬───────┘
               ▼
       applyConfirm (Idempotent)
               │
               ├─► Mandate remainingPaise -= total
               ├─► Inventory stock -= qty
               └─► SHA-256 Append-Only Audit Record
```

---

## 7. License & Hackathon Attribution
Built for the Razorpay AI Buildathon — Track 01 (Agentic Commerce).
All core safety protocols, guardrail enforcement, mandate management, and audit verification algorithms are original implementations.
