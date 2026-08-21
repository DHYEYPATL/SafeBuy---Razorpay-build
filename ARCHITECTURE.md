# SafeBuy System Architecture

## Overview
SafeBuy establishes a safe execution container around an autonomous AI agent to make merchant stores transactable under Indian financial regulations.

---

## 1. End-to-End Execution Sequence

```mermaid
sequenceDiagram
    autonumber
    actor Human as User / Cardholder
    participant UI as SafeBuy Web UI
    participant Agent as SafeBuy Orchestrator (Zustand Store)
    participant Guard as Deterministic Guardrail
    participant RZP_API as Razorpay API (Server Fn)
    participant RZP_CO as Razorpay Checkout.js
    participant Audit as Hash-Chained Audit Store

    Note over Human,UI: Phase 1: Setup & Intent
    Human->>UI: Create Mandate (Spend cap, categories, simulated AFA PIN)
    UI->>Agent: createMandate()
    Agent->>Audit: appendAudit(mandate.created) [LIVE]
    Human->>UI: "Buy 1 kg basmati under ₹150"
    UI->>Agent: runInstruction(text)
    Agent->>Agent: parseIntent(text) [LIVE / Grok Coercion]
    Agent->>Audit: appendAudit(intent.parsed) [LIVE]

    Note over Agent,Guard: Phase 2: Planning & Safety Gate
    Agent->>Agent: planCart(mandate, intent, liveStock)
    Agent->>Guard: runGuardrail(cart, mandate, intent)
    alt Guardrail Passes
        Guard-->>Agent: { ok: true, code: "pass" }
        Agent->>Audit: appendAudit(guardrail.pass) [LIVE]
    else Semantic Mismatch / AFA > 15k
        Guard-->>Agent: { ok: false, needsHumanConfirm: true }
        Agent->>UI: Display Human Confirmation Modal
        Human->>UI: Click "Confirm & Proceed"
        UI->>Agent: confirmSemanticOverride()
        Agent->>Audit: appendAudit(semantic.human_override) [LIVE]
    end

    Note over Agent,UI: Phase 3: Notify-then-Execute Gate
    Agent->>UI: 5s Pre-debit Countdown Window [SYNTHETIC notice]
    Agent->>Audit: appendAudit(notify.pre_debit) [SYNTHETIC]
    Note over Agent: Window elapses without user abort

    Note over Agent,RZP_CO: Phase 4: Order Creation & Checkout
    Agent->>RZP_API: createRazorpayOrder(amountPaise, receipt)
    RZP_API->>RZP_API: POST https://api.razorpay.com/v1/orders [LIVE]
    RZP_API-->>Agent: { ok: true, orderId: "order_xyz" }
    Agent->>Audit: appendAudit(razorpay.order_created) [LIVE]
    Agent->>RZP_CO: openRazorpayCheckout({ orderId: "order_xyz", amountPaise })
    Human->>RZP_CO: Complete Test Mode Card Payment
    RZP_CO-->>Agent: handler({ payment_id, order_id, signature })

    Note over Agent,RZP_API: Phase 5: Verification & Reconciliation
    Agent->>RZP_API: verifyCheckoutSignature(order_id, payment_id, signature)
    RZP_API-->>Agent: { ok: true }
    Agent->>Agent: phase = "pending" [LIVE]
    Agent->>Audit: appendAudit(razorpay.handler_received) [LIVE]
    
    loop Polling Status Loop (N=6, delay 2s)
        Agent->>RZP_API: fetchRazorpayPayment(payment_id)
        RZP_API->>RZP_API: GET https://api.razorpay.com/v1/payments/:id [LIVE]
        RZP_API-->>Agent: { status: "captured" }
    end

    Note over Agent,Audit: Phase 6: Confirmation & Settlement
    Agent->>Agent: applyConfirm(source: "fetch", status: "captured")
    Agent->>Agent: mandate.remainingPaise -= totalPaise
    Agent->>Agent: liveStock[sku] -= qty
    Agent->>Agent: confirmedPaymentIds.push(payment_id)
    Agent->>Audit: appendAudit(razorpay.confirmed) [LIVE]
    Agent->>UI: Update Phase to "confirmed" & show confirmation
```

---

## 2. Security & Idempotency Invariants

1. **Mandate Immutability:** Mandate limits cannot be overridden by raw LLM output or prompt injections. The guardrail diffs strongly-typed numeric and category schemas.
2. **Order-Gated Execution:** No Checkout UI can open without an existing server Order ID (`order_id`).
3. **Status-Gated Mandate Decrement:** The client handler never decrements the mandate directly. Mandate balances change only when backend Fetch or Webhooks report `status === "captured"`.
4. **Strict Idempotency:** The global `confirmedPaymentIds` tracking table prevents duplicate webhook deliveries or double-submitted handlers from charging the mandate twice.
5. **Cryptographic Chain:** Every audit entry calculates `SHA-256(prevHash + "|" + canonicalJson(body))` ensuring tampering detection.
